# BUILD-TRANSCRIPT — TICKR Agent (Base Stocks Maxxing Builder Quest)

**Built:** Tuesday 17 Nov 2026, ~07:30–09:00 WIB, by an AI agent working solo.
**Track:** Agentic Stock Finance. **Status:** app complete and tested; Base Sepolia deployment pending testnet ETH (faucet step needs a browser); submission drafts ready for the human steps (Google Form + X post).

## What was built

**TICKR Agent** — a transparent agentic research & paper-trading app for Coinbase tokenized stocks on Base.

- **Web app** (static, no build step): `index.html` + `app.js` + `styles.css`, served from repo root via GitHub Pages.
  - Live market table from the Coinbase Tokenized Stocks API (377 tokens).
  - Rule-based agent analysis with published scoring rules and per-signal reasons.
  - Paper portfolio (virtual $10,000, localStorage) with live-NAV P&L.
  - Onchain journal reader (Base Sepolia public RPC, 3-RPC fallback).
  - US-exclusion gate: IP geolocation (ipapi.co, free, no key) + timezone fallback + self-attestation checkbox; trading disabled for US users.
  - In-app "Deploy journal contract" button (user's own wallet, testnet gas).
- **Agent logic** (`app/agent.js`, zero dependencies, shared browser + Node): API fetch with pagination, transparent scoring (freshness / supply / drift), position sizing (≤10% cash per BUY), paper-portfolio math, ERC-8021 suffix encode/decode.
- **Smart contract** (`contracts/TradeJournal.sol`): public append-only journal of paper trades — ticker, side, qty (milli-shares), NAV price (cents), keccak256 of reasoning text, timestamp. Compiled with solc 0.8.30, evmVersion Shanghai (pinned: the default Osaka target emits opcodes local test chains reject — found and fixed during testing).
- **Scripts**: `compile.js`, `deploy.js` (Sepolia + local), `test-local.js` (full E2E).
- **Builder Code**: `bc_sijyqbvn` registered for the agent wallet `0x822bbE7174FC3E54cc278AD35dDE6532b2F8415B` (testnet-only throwaway; key at `~/.config/base-stocks-maxxing-deployer.key`, mode 600, NOT in repo).

## Verified live (not assumed)

| Check | Evidence |
|---|---|
| Tokenized Stocks API reachable, no key | `GET https://api.coinbase.com/v1/tokenized-stocks` → HTTP 200; 377 tokens total; 12 with live NAV (NVDAc, AAPLc, TSLAc, GOOGLc, MSFTc, METAc, AMZNc, MSTRc, INTCc, CRCLc, SNDKc, SPCXc); NAV timestamps 16–17 Nov 2026 |
| API has no Sepolia/testnet chain | `/chains` returns only chain 8453 (Base mainnet) — B20 tokens are mainnet-only; hence paper-trade journal design on Sepolia instead of touching real tokens |
| Builder Code registration works, no auth | `POST https://api.base.dev/v1/agents/builder-codes` → HTTP 200, `bc_sijyqbvn` |
| Base Sepolia public RPC live | `eth_blockNumber` on `https://sepolia.base.org` → block 59,767,857; chainId 84532 confirmed |
| Contract compiles | solc 0.8.30, 2,695 bytes bytecode, 5 ABI entries |
| Full E2E on local chain | `node scripts/test-local.js` → **23/23 checks passed, 3 consecutive runs**: deploy, live-API fetch, agent BUY signals (MSTRc, NVDAc, CRCLc, SNDKc, INTCc), 2 onchain paper trades mined, journal read-back, reason-hash match, ERC-8021 suffix decoded from raw tx input as `bc_sijyqbvn`, TradeLogged events queryable, stale-NAV AVOID, qty-0/empty-ticker reverts, portfolio math |
| Static app serves | `python3 -m http.server`: `/`, `/app.js`, `/styles.css`, `/app/agent.js`, `/app/contract.json` all HTTP 200 |
| JS syntax | `node --check` clean on app.js, agent.js, all scripts |

## NOT yet verified / pending (honest gaps)

1. **TradeJournal is NOT deployed on Base Sepolia yet.** Deployer wallet balance is 0 ETH. Faucets that work without an account (QuickNode) sit behind Cloudflare + captcha and need a browser; the agent has no live-browser access. Unblocks via: (a) a browser task claiming the QuickNode faucet for `0x822bbE7174FC3E54cc278AD35dDE6532b2F8415B`, then `node scripts/deploy.js`; or (b) the user deploying from the app's own "Deploy journal" button with their wallet. Until then the app shows "journal not deployed yet" and paper trades are blocked by design (trades only count when logged onchain).
2. **GitHub repo NOT created yet.** `create_repository` (public `Tiannuryadins/tickr-agent`) was attempted 17 Nov ~08:00 WIB; the write-approval card expired unanswered after ~30 min (`approval_expired`, approval_id `connector-attempt-eaf758bec0a00492862f1839945d3f6e82b2661c66c4b404de32dac2f2ac5db0`) and the action was not performed — verified: 0 repos found for `tickr-agent user:Tiannuryadins`. Snapshot push is fully prepared: 16 files, 250 KB, NUL-delimited manifest at `~/workspace/base-stocks-maxxing-paths.txt`; once the repo exists, run `github push-files --owner Tiannuryadins --repo tickr-agent --branch main --message "TICKR Agent: transparent agentic research & paper trading for tokenized stocks on Base Sepolia" --source-dir ~/workspace/base-stocks-maxxing --paths-file ~/workspace/base-stocks-maxxing-paths.txt`. GitHub Pages must then be enabled in repo Settings (Pages → Deploy from branch `main`, folder `/ (root)`) — no MCP tool covers Pages setup, so this is a browser/human step. **Do not treat the demo URL as live until Pages is verified serving.**
3. **No real browser run of the UI.** Syntax + static serving verified; the full click-through (wallet connect, MetaMask signing) has not been exercised in a real browser. The demo-video recording step will exercise it.
4. **ipapi.co geo-check** not yet exercised from a browser (free tier, 1,000 req/day/IP). Fallbacks (timezone + attestation) are in place if it fails.
5. **Traction is zero.** No users, no onchain usage yet. Stated openly in the app and in the submission draft.

## Design decisions worth noting

- **Why a journal contract, not real token trades:** B20 tokenized stocks exist only on Base mainnet (per the API's own `/chains` endpoint). Real mainnet trading would cost real money and violate the free-only rule; a paper-trade journal on Sepolia is the honest testnet-native design, and the quest rules explicitly allow testnet without penalty.
- **Why rule-based, not an LLM:** the agent's decisions must be auditable and reproducible. Published rules + reason hashes make every decision verifiable; an LLM call would add cost, nondeterminism, and unverifiable claims.
- **Why the app blocks trades until the journal exists:** a paper trade that isn't logged onchain is just a local number. The onchain log is the product's core claim, so the UI refuses to fake it.

## Costs incurred

$0. Testnet only, no subscriptions, no paid APIs, no mainnet transactions.
