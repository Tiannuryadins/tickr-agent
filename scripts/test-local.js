// Full local E2E test: in-process ganache chain + LIVE Tokenized Stocks API.
//  1. Deploy TradeJournal locally.
//  2. Fetch real token data from the Coinbase API.
//  3. Run the agent analysis; execute the top BUY signals as onchain paper trades
//     with the ERC-8021 Builder Code suffix appended to calldata.
//  4. Read the journal back; verify reason hashes + suffix decode from tx input.
//  5. Exercise edge cases: stale-NAV AVOID, zero-qty revert, empty-ticker revert.
// Exit 0 = all checks passed.
const Ganache = require("ganache");
const { ethers } = require("ethers");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const artifact = require(path.join(root, "build", "TradeJournal.json"));

async function main() {
  // Dynamic import: app/agent.js is ESM.
  const agent = await import(path.join(root, "app", "agent.js"));
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
    if (!ok) process.exitCode = 1;
  };

  // --- 1. Local chain + deploy ---------------------------------------------
  const server = Ganache.server({ wallet: { deterministic: true } });
  await server.listen(0);
  const port = server.address().port;
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`);
  const wallet = new ethers.Wallet(
    "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
    provider
  );
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const journal = await factory.deploy();
  await journal.waitForDeployment();
  const address = await journal.getAddress();
  check("deploy TradeJournal on local chain", !!address, address);

  // --- 2. Live API ----------------------------------------------------------
  const tokens = await agent.fetchAllTokens();
  check("fetch live token list from Coinbase API", tokens.length > 100, `${tokens.length} tokens`);
  const priced = tokens.filter((t) => t.nav_price != null);
  check("tokens with live NAV price", priced.length >= 5, `${priced.length} priced`);

  // --- 3. Agent analysis + onchain paper trades -----------------------------
  const analyses = agent.analyzeAll(tokens, {});
  const buys = analyses.filter((a) => a.signal === "BUY");
  const avoids = analyses.filter((a) => a.signal === "AVOID");
  check("agent produces BUY signals", buys.length >= 1, buys.map((b) => b.symbol).join(", "));
  check("agent produces AVOID signals (no-NAV tokens)", avoids.length > 100, `${avoids.length} avoids`);

  const portfolio = agent.newPortfolio();
  const suffix = agent.erc8021Suffix(agent.BUILDER_CODE);
  check("ERC-8021 suffix encodes builder code", suffix.startsWith("0x62635f"), suffix);

  const executed = [];
  // Manage the nonce with a local counter: ganache + ethers nonce polling races.
  let nextNonce = await provider.getTransactionCount(wallet.address, "latest");
  for (const rec of buys.slice(0, 2)) {
    const sizing = agent.sizeBuy(rec.nav, portfolio.cashCents);
    assert(sizing, "sizing failed");
    const reasonText = `TICKR agent BUY ${rec.symbol} @ NAV $${rec.nav} (score ${rec.score}). ` + rec.reasons.join(" ");
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(reasonText));
    const priceCents = Math.round(rec.nav * 100);
    // Build calldata manually so the ERC-8021 suffix is appended.
    const data = journal.interface.encodeFunctionData("logTrade", [
      rec.symbol, true, sizing.qtyMilli, priceCents, reasonHash,
    ]);
    const nonce = nextNonce++;
    const tx = await wallet.sendTransaction({ to: address, data: data + suffix.slice(2), nonce });
    const receipt = await tx.wait();
    check(`onchain paper trade ${rec.symbol} mined`, receipt.status === 1, tx.hash);
    agent.applyPaperTrade(portfolio, {
      symbol: rec.symbol, isBuy: true, qtyMilli: sizing.qtyMilli, priceCents,
    });
    executed.push({ txHash: tx.hash, symbol: rec.symbol, reasonHash, reasonText });
  }

  // --- 4. Read back + verify -------------------------------------------------
  const count = await journal.tradeCount();
  check("journal tradeCount matches executions", Number(count) === executed.length, `${count}`);
  const stored = await journal.getTrades(0, 10);
  check("getTrades returns stored trades", stored.length === executed.length);
  for (let i = 0; i < executed.length; i++) {
    check(`stored trade ${i} ticker`, stored[i].ticker === executed[i].symbol, stored[i].ticker);
    check(`stored trade ${i} reasonHash`, stored[i].reasonHash === executed[i].reasonHash);
    const tx = await provider.getTransaction(executed[i].txHash);
    const decoded = agent.decodeErc8021Suffix(tx.data);
    check(
      `tx ${i} carries ERC-8021 suffix`,
      decoded && decoded.codes === agent.BUILDER_CODE,
      decoded ? decoded.codes : "no suffix"
    );
    // Reason hash must match the published reasoning text.
    const recomputed = ethers.keccak256(ethers.toUtf8Bytes(executed[i].reasonText));
    check(`reason hash ${i} matches published text`, recomputed === executed[i].reasonHash);
  }

  // Events readable via eth_getLogs (what the app uses).
  const logs = await journal.queryFilter(journal.filters.TradeLogged());
  check("TradeLogged events queryable", logs.length === executed.length, `${logs.length} events`);

  // --- 5. Edge cases ---------------------------------------------------------
  const stale = agent.analyzeToken(
    { symbol: "TESTc", name: "Test", nav_price: 100, nav_price_updated_at: new Date(Date.now() - 48 * 3600e3).toISOString() },
    null
  );
  check("stale NAV (>6h) forces AVOID", stale.signal === "AVOID" && !stale.tradeable);

  let reverted = false;
  try {
    await journal.logTrade.staticCall("NVDAc", true, 0, 10000, ethers.ZeroHash);
  } catch { reverted = true; }
  check("logTrade reverts on qty 0", reverted);

  reverted = false;
  try {
    await journal.logTrade.staticCall("", true, 1000, 10000, ethers.ZeroHash);
  } catch { reverted = true; }
  check("logTrade reverts on empty ticker", reverted);

  // Portfolio math.
  const navs = {};
  for (const t of tokens) if (t.nav_price != null) navs[t.symbol] = Number(t.nav_price);
  const val = agent.portfolioValue(portfolio, navs);
  check("portfolio value ≈ starting cash (no price move)", Math.abs(val.totalCents - 1_000_000) < 500, `$${(val.totalCents / 100).toFixed(2)}`);

  await server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error("E2E test crashed:", e);
  process.exit(1);
});
