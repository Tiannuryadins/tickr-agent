// TICKR Agent — browser app (ES module).
// Talks to: (1) Coinbase Tokenized Stocks API (live, no key),
//           (2) Base Sepolia public RPC (read journal + chain state),
//           (3) the user's wallet (MetaMask) for signing paper-trade logs.
// Everything onchain is testnet-only. No real assets move anywhere.
import {
  fetchAllTokens,
  analyzeAll,
  sizeBuy,
  newPortfolio,
  applyPaperTrade,
  portfolioValue,
  erc8021Suffix,
  BUILDER_CODE,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_EXPLORER,
} from "./app/agent.js";
import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";

const RPCS = [
  "https://sepolia.base.org",
  "https://base-sepolia.api.onfinality.io/public",
  "https://base-sepolia-rpc.publicnode.com",
];
const LS_PORTFOLIO = "tickr-portfolio-v1";
const LS_JOURNAL = "tickr-journal-address";
const LS_JOURNAL_BLOCK = "tickr-journal-block";

const $ = (id) => document.getElementById(id);
const fmtUsd = (cents) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtNav = (nav) =>
  nav == null ? "—" : Number(nav).toLocaleString("en-US", { style: "currency", currency: "USD" });
const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let tokens = [];
let analyses = [];
let portfolio = loadPortfolio();
let journalAddress = localStorage.getItem(LS_JOURNAL) || null;
let journalDeployBlock = Number(localStorage.getItem(LS_JOURNAL_BLOCK) || 0);
let contractArtifact = null;
let readProvider = null;
let signer = null;
let userAddress = null;
let geoBlocked = false;
let geoChecked = false;

// ---- persistence ------------------------------------------------------------
function loadPortfolio() {
  try {
    const raw = localStorage.getItem(LS_PORTFOLIO);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted storage -> fresh portfolio */ }
  return newPortfolio();
}
function savePortfolio() {
  localStorage.setItem(LS_PORTFOLIO, JSON.stringify(portfolio));
}

// ---- US exclusion gate ------------------------------------------------------
// Layer 1: IP geolocation (ipapi.co, free, no key). Layer 2: timezone fallback.
// Layer 3: explicit self-attestation checkbox. US => trading hard-disabled.
async function runGeoCheck() {
  const status = $("geoStatus");
  const banner = $("usBanner");
  let country = null;
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (res.ok) {
      const geo = await res.json();
      country = geo.country_code || null;
    }
  } catch { /* offline / blocked -> fall through to timezone check */ }
  if (!country) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz.startsWith("America/")) {
      status.textContent =
        "Location check inconclusive (timezone looks like the Americas). Trading stays disabled unless you confirm you are not a U.S. person — and the IP check will be retried on each visit.";
      geoChecked = true;
      updateGate();
      return;
    }
    status.textContent =
      "Location service unreachable and timezone is outside the Americas — proceeding on self-attestation. Trading requires the confirmation below.";
    geoChecked = true;
    updateGate();
    return;
  }
  geoChecked = true;
  if (country === "US") {
    geoBlocked = true;
    banner.classList.remove("hidden");
    banner.textContent =
      "⛔ You appear to be located in the United States. Tokenized stocks are not available to U.S. persons, so trading is disabled in this app. You can still browse market data and agent analysis (read-only).";
    status.textContent = "Location detected: United States — trading disabled.";
    $("attestBox").disabled = true;
  } else {
    banner.classList.remove("hidden");
    banner.classList.add("ok");
    banner.textContent = `✓ Location check passed (${country}). Trading is available after you confirm the statement below.`;
    status.textContent = `Location detected: ${country} (not the US).`;
  }
  updateGate();
}

function tradingEnabled() {
  return geoChecked && !geoBlocked && $("attestBox").checked;
}
function updateGate() {
  const enabled = tradingEnabled();
  document.querySelectorAll("[data-needs-trade]").forEach((el) => {
    el.disabled = !enabled;
  });
  $("gateNote").textContent = enabled
    ? "Eligibility confirmed — trading controls are enabled."
    : geoBlocked
      ? "Trading is disabled for users located in the United States."
      : "Trading controls stay disabled until the location check passes and you confirm the statement above.";
}

// ---- read provider (with RPC fallback) --------------------------------------
async function getReadProvider() {
  if (readProvider) return readProvider;
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      readProvider = p;
      return p;
    } catch { /* try next RPC */ }
  }
  throw new Error("All Base Sepolia public RPCs unreachable.");
}

// ---- market -----------------------------------------------------------------
async function loadMarket() {
  $("marketStatus").textContent = "Fetching live data…";
  try {
    tokens = await fetchAllTokens();
  } catch (e) {
    $("marketStatus").textContent = "Could not reach the Tokenized Stocks API: " + e.message;
    return;
  }
  const priced = tokens.filter((t) => t.nav_price != null);
  $("statTokens").textContent = tokens.length;
  $("statPriced").textContent = priced.length;
  $("marketStatus").textContent =
    `Live · ${tokens.length} tokens · ${priced.length} with NAV · updated ${new Date().toLocaleTimeString()} UTC`;
  renderMarket($("searchInput").value.trim());
  renderPortfolio();
}

function renderMarket(query = "") {
  const q = query.toLowerCase();
  const priced = tokens.filter((t) => t.nav_price != null);
  const rest = tokens.filter((t) => t.nav_price == null);
  let rows = [...priced, ...rest];
  if (q) {
    rows = rows.filter(
      (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    );
  }
  rows = rows.slice(0, 60);
  const now = Date.now();
  $("marketTable").querySelector("tbody").innerHTML = rows
    .map((t) => {
      const age = t.nav_price_updated_at
        ? ((now - Date.parse(t.nav_price_updated_at)) / 3600e3).toFixed(1) + "h"
        : "—";
      const stale = t.nav_price_updated_at && now - Date.parse(t.nav_price_updated_at) > 6 * 3600e3;
      return `<tr>
        <td><strong>${esc(t.symbol)}</strong></td>
        <td>${esc(t.name)}</td>
        <td>${fmtNav(t.nav_price)}</td>
        <td class="${stale ? "neg" : ""}">${age}${stale ? " (stale)" : ""}</td>
        <td>${t.total_supply != null ? Number(t.total_supply).toLocaleString() : "—"}</td>
        <td>${t.multiplier ?? "—"}</td>
        <td><a class="mono" href="https://basescan.org/address/${t.contract_address}" target="_blank" rel="noopener">${shortAddr(t.contract_address)}</a></td>
      </tr>`;
    })
    .join("");
}

// ---- agent ------------------------------------------------------------------
async function runAgent() {
  if (!tokens.length) await loadMarket();
  $("agentStatus").textContent = "Analyzing…";
  analyses = analyzeAll(tokens, portfolio.snapshots || {});
  // Record fresh NAV snapshots for drift tracking on the next run.
  for (const t of tokens) {
    if (t.nav_price != null) {
      portfolio.snapshots[t.symbol] = { nav: Number(t.nav_price), at: new Date().toISOString() };
    }
  }
  savePortfolio();
  const buys = analyses.filter((a) => a.signal === "BUY").length;
  $("agentStatus").textContent =
    `Done · ${analyses.length} tokens scored · ${buys} BUY signals · ${new Date().toLocaleTimeString()} UTC`;
  renderAgent();
  renderPortfolio();
}

function renderAgent() {
  const body = $("agentTable").querySelector("tbody");
  const shown = analyses.filter((a) => a.nav != null || a.signal !== "AVOID").slice(0, 40);
  const priced = analyses.filter((a) => a.nav != null);
  const rows = priced.length ? priced : shown;
  body.innerHTML = rows
    .map((a) => {
      const sizing = a.signal === "BUY" ? sizeBuy(a.nav, portfolio.cashCents) : null;
      const action =
        a.signal === "BUY" && sizing
          ? `<button class="btn small primary" data-needs-trade data-buy="${esc(a.symbol)}" ${tradingEnabled() ? "" : "disabled"}>Paper BUY ${(sizing.qtyMilli / 1000).toFixed(3)} sh · ${fmtUsd(sizing.spendCents)}</button>`
          : a.signal === "BUY"
            ? `<span class="muted small">BUY signal, but paper cash too low to size a trade.</span>`
            : `<span class="muted small">—</span>`;
      return `<tr>
        <td><strong>${esc(a.symbol)}</strong><br><span class="muted small">${esc(a.name || "")}</span></td>
        <td>${a.score}</td>
        <td><span class="sig ${a.signal}">${a.signal}</span></td>
        <td>${fmtNav(a.nav)}</td>
        <td class="reasons"><ul>${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></td>
        <td>${action}</td>
      </tr>`;
    })
    .join("");
  body.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", () => executePaperTrade(btn.dataset.buy, true));
  });
}

// ---- portfolio --------------------------------------------------------------
function renderPortfolio() {
  const navs = {};
  for (const t of tokens) if (t.nav_price != null) navs[t.symbol] = Number(t.nav_price);
  const val = portfolioValue(portfolio, navs);
  $("pfCash").textContent = fmtUsd(val.cashCents);
  $("pfPositions").textContent = fmtUsd(val.positionsValueCents);
  $("pfTotal").textContent = fmtUsd(val.totalCents);
  const pnlEl = $("pfPnl");
  pnlEl.textContent = `${fmtUsd(val.pnlCents)} (${val.pnlPct.toFixed(2)}%)`;
  pnlEl.className = val.pnlCents >= 0 ? "pos" : "neg";
  $("statCash").textContent = fmtUsd(val.totalCents);

  const body = $("portfolioTable").querySelector("tbody");
  const entries = Object.entries(portfolio.positions);
  if (!entries.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted">No positions yet — run the agent and execute a paper BUY.</td></tr>`;
    return;
  }
  body.innerHTML = entries
    .map(([symbol, pos]) => {
      const nav = navs[symbol];
      const valueCents = nav != null ? Math.round((pos.qtyMilli / 1000) * nav * 100) : null;
      const costCents = Math.round((pos.qtyMilli / 1000) * pos.avgCostCents);
      const pnl = valueCents != null ? valueCents - costCents : null;
      return `<tr>
        <td><strong>${esc(symbol)}</strong></td>
        <td>${(pos.qtyMilli / 1000).toFixed(3)}</td>
        <td>${fmtUsd(pos.avgCostCents)}</td>
        <td>${fmtNav(nav)}</td>
        <td>${valueCents != null ? fmtUsd(valueCents) : "—"}</td>
        <td class="${pnl == null ? "" : pnl >= 0 ? "pos" : "neg"}">${pnl != null ? fmtUsd(pnl) : "—"}</td>
        <td><button class="btn small" data-needs-trade data-sell="${esc(symbol)}" ${tradingEnabled() ? "" : "disabled"}>Sell all (paper)</button></td>
      </tr>`;
    })
    .join("");
  body.querySelectorAll("[data-sell]").forEach((btn) => {
    btn.addEventListener("click", () => executePaperTrade(btn.dataset.sell, false));
  });
}

// ---- wallet -----------------------------------------------------------------
async function connectWallet() {
  if (!window.ethereum) {
    alert("No wallet found. Install MetaMask (or another EIP-1193 wallet) to sign testnet transactions.");
    return;
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x14a34" }],
      });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x14a34",
            chainName: "Base Sepolia",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://sepolia.base.org"],
            blockExplorerUrls: [BASE_SEPOLIA_EXPLORER],
          }],
        });
      } else {
        throw switchErr;
      }
    }
  }
  signer = await provider.getSigner();
  userAddress = await signer.getAddress();
  $("connectBtn").textContent = "Connected: " + shortAddr(userAddress);
  $("networkBadge").textContent = "Base Sepolia · " + shortAddr(userAddress);
  $("networkBadge").classList.add("ok");
}

// ---- journal contract -------------------------------------------------------
async function loadArtifact() {
  if (contractArtifact) return contractArtifact;
  const res = await fetch("app/contract.json");
  contractArtifact = await res.json();
  return contractArtifact;
}

async function loadDeployment() {
  if (journalAddress) return;
  try {
    const res = await fetch("app/deployment.json");
    if (res.ok) {
      const dep = await res.json();
      journalAddress = dep.address;
      journalDeployBlock = dep.deployBlock || 0;
    }
  } catch { /* not deployed yet — user can deploy from the UI */ }
}

async function getJournalContract(providerOrSigner) {
  const artifact = await loadArtifact();
  return new ethers.Contract(journalAddress, artifact.abi, providerOrSigner);
}

async function refreshJournal() {
  const status = $("journalStatus");
  await loadDeployment();
  if (!journalAddress) {
    status.textContent =
      "Journal contract not deployed yet on Base Sepolia. Deploy it from your wallet (free testnet gas from a faucet) or wait for the project deploy.";
    $("journalAddr").textContent = "";
    $("statJournal").textContent = "–";
    return;
  }
  $("journalAddr").innerHTML =
    `Journal: <a href="${BASE_SEPOLIA_EXPLORER}/address/${journalAddress}" target="_blank" rel="noopener">${shortAddr(journalAddress)}</a> (Builder Code ${BUILDER_CODE})`;
  try {
    const provider = await getReadProvider();
    const journal = await getJournalContract(provider);
    const count = Number(await journal.tradeCount());
    $("statJournal").textContent = count;
    status.textContent = `${count} paper trade(s) logged onchain.`;
    const body = $("journalTable").querySelector("tbody");
    if (count === 0) {
      body.innerHTML = `<tr><td colspan="8" class="muted">Journal deployed, no entries yet.</td></tr>`;
      return;
    }
    // Prefer events (they carry tx hashes); fall back to getTrades.
    let entries = [];
    try {
      const logs = await journal.queryFilter(journal.filters.TradeLogged(), journalDeployBlock || 0);
      entries = logs.map((l) => ({ ...l.args, txHash: l.transactionHash })).reverse();
    } catch {
      const page = await journal.getTrades(0, Math.min(count, 100));
      entries = [...page].reverse().map((t, i) => ({ ...t, id: BigInt(count - 1 - i), txHash: null }));
    }
    body.innerHTML = entries
      .slice(0, 50)
      .map((e) => `<tr>
        <td>${e.id}</td>
        <td>${new Date(Number(e.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 19)}</td>
        <td><strong>${esc(e.ticker)}</strong></td>
        <td><span class="sig ${e.isBuy ? "BUY" : "AVOID"}">${e.isBuy ? "BUY" : "SELL"}</span></td>
        <td>${(Number(e.qtyMilli) / 1000).toFixed(3)}</td>
        <td>${fmtUsd(Number(e.priceCents))}</td>
        <td class="mono">${String(e.reasonHash).slice(0, 12)}…</td>
        <td>${e.txHash ? `<a href="${BASE_SEPOLIA_EXPLORER}/tx/${e.txHash}" target="_blank" rel="noopener">view ↗</a>` : "—"}</td>
      </tr>`)
      .join("");
  } catch (e) {
    status.textContent = "Could not read the journal: " + e.message;
  }
}

async function deployJournal() {
  if (!signer) {
    alert("Connect your wallet first (Base Sepolia). You need a little testnet ETH from a faucet for gas — free.");
    await connectWallet();
    if (!signer) return;
  }
  const artifact = await loadArtifact();
  $("journalStatus").textContent = "Deploying TradeJournal — confirm in your wallet…";
  try {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
    const contract = await factory.deploy();
    $("journalStatus").textContent = "Deploy tx sent: " + contract.deploymentTransaction().hash + " — waiting for confirmation…";
    const receipt = await contract.waitForDeployment().then(() => contract.deploymentTransaction().wait());
    journalAddress = await contract.getAddress();
    journalDeployBlock = receipt.blockNumber;
    localStorage.setItem(LS_JOURNAL, journalAddress);
    localStorage.setItem(LS_JOURNAL_BLOCK, String(journalDeployBlock));
    $("journalStatus").textContent = "Journal deployed at " + journalAddress;
    await refreshJournal();
  } catch (e) {
    $("journalStatus").textContent = "Deploy failed: " + (e.reason || e.message);
  }
}

// ---- paper trade execution --------------------------------------------------
function buildReasonText(analysis, isBuy, qtyMilli, priceCents) {
  const side = isBuy ? "BUY" : "SELL";
  const base = `TICKR agent ${side} ${analysis.symbol} ${(qtyMilli / 1000).toFixed(3)} sh @ NAV $${(priceCents / 100).toFixed(2)} (score ${analysis.score}). `;
  return base + analysis.reasons.join(" ");
}

async function executePaperTrade(symbol, isBuy) {
  if (!tradingEnabled()) {
    alert("Trading is disabled: complete the eligibility gate first (location check + confirmation).");
    return;
  }
  if (!journalAddress) {
    alert("The onchain journal is not deployed yet. Deploy it first (button in section 5) — paper trades are only counted when they are logged onchain.");
    return;
  }
  if (!signer) await connectWallet();
  if (!signer) return;

  const analysis = analyses.find((a) => a.symbol === symbol);
  const live = tokens.find((t) => t.symbol === symbol);
  const nav = live && live.nav_price != null ? Number(live.nav_price) : null;
  if (nav == null) {
    alert("No live NAV price for " + symbol + " — the agent never trades without a price.");
    return;
  }
  const priceCents = Math.round(nav * 100);
  let qtyMilli;
  if (isBuy) {
    const sizing = sizeBuy(nav, portfolio.cashCents);
    if (!sizing) {
      alert("Not enough paper cash to size this BUY.");
      return;
    }
    qtyMilli = sizing.qtyMilli;
  } else {
    const pos = portfolio.positions[symbol];
    if (!pos) {
      alert("No paper position in " + symbol + " to sell.");
      return;
    }
    qtyMilli = pos.qtyMilli;
  }

  const reasons = analysis
    ? analysis.reasons
    : [`Manual SELL of paper position at live NAV $${nav}.`];
  const reasonText = buildReasonText(
    { symbol, score: analysis ? analysis.score : 0, reasons },
    isBuy, qtyMilli, priceCents
  );
  const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(reasonText));

  $("agentStatus").textContent = `Logging ${isBuy ? "BUY" : "SELL"} ${symbol} onchain — confirm in your wallet…`;
  try {
    const journal = await getJournalContract(signer);
    const data = journal.interface.encodeFunctionData("logTrade", [
      symbol, isBuy, qtyMilli, priceCents, reasonHash,
    ]);
    const suffix = erc8021Suffix(BUILDER_CODE);
    const tx = await signer.sendTransaction({ to: journalAddress, data: data + suffix.slice(2) });
    $("agentStatus").textContent = "Tx sent: " + tx.hash + " — waiting for confirmation…";
    await tx.wait();
    applyPaperTrade(portfolio, { symbol, isBuy, qtyMilli, priceCents });
    portfolio.trades.push({
      symbol, isBuy, qtyMilli, priceCents, reasonHash, reasonText,
      txHash: tx.hash, at: new Date().toISOString(),
    });
    savePortfolio();
    $("agentStatus").textContent =
      `✓ Paper ${isBuy ? "BUY" : "SELL"} ${symbol} logged onchain: ${tx.hash}`;
    renderPortfolio();
    renderAgent();
    await refreshJournal();
  } catch (e) {
    $("agentStatus").textContent = "Trade failed: " + (e.reason || e.message);
  }
}

// ---- wire up ----------------------------------------------------------------
$("refreshMarketBtn").addEventListener("click", loadMarket);
$("searchInput").addEventListener("input", (e) => renderMarket(e.target.value.trim()));
$("runAgentBtn").addEventListener("click", runAgent);
$("connectBtn").addEventListener("click", () => connectWallet().catch((e) => alert("Wallet error: " + e.message)));
$("refreshJournalBtn").addEventListener("click", refreshJournal);
$("deployJournalBtn").addEventListener("click", () => deployJournal().catch((e) => alert("Deploy error: " + e.message)));
$("attestBox").addEventListener("change", updateGate);
$("resetPortfolioBtn").addEventListener("click", () => {
  if (confirm("Reset the paper portfolio to $10,000 virtual cash? Onchain journal entries are permanent and are NOT deleted.")) {
    portfolio = newPortfolio();
    savePortfolio();
    renderPortfolio();
    renderAgent();
  }
});

(async function init() {
  renderPortfolio();
  updateGate();
  await Promise.all([runGeoCheck(), loadMarket(), refreshJournal()]);
})();
