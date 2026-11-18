# TICKR Agent

**Transparent agentic research & paper trading for tokenized stocks on Base.**

Built for the [Base Stocks Maxxing Builder Quest](https://www.base.org/stocksmaxxing) — **Agentic Stock Finance** track. Testnet only. No real money. US persons excluded.

Live demo: https://tiannuryadins.github.io/tickr-agent/ (GitHub Pages)

## What it does

1. **Reads live data** — pulls the full catalog of Coinbase tokenized stocks from the public [Tokenized Stocks API](https://docs.base.org/sdks/tokenized-stocks/overview) (`https://api.coinbase.com/v1/tokenized-stocks`, read-only, no API key). 377 tokens; 12 currently publish a live Chainlink NAV price.
2. **Researches transparently** — a rule-based agent scores every priced token. The rules are published in the UI and in [`app/agent.js`](app/agent.js): NAV freshness, supply depth, drift vs. last snapshot. Every signal carries its reasons. No NAV → no trade, ever.
3. **Paper-trades onchain** — each BUY/SELL decision is logged to the public `TradeJournal` contract on **Base Sepolia testnet** (chain 84532), storing the decision plus a keccak256 hash of the reasoning text, so anyone can verify a logged decision matches the published reasoning. Every journal transaction carries the ERC-8021 Builder Code suffix `bc_sijyqbvn`.
4. **Excludes U.S. persons** — IP geolocation check + timezone fallback + explicit self-attestation gate. Trading controls are disabled for users located in the United States, because Coinbase tokenized stocks are not available to U.S. persons.

## Honest limitations

- **Paper trading only.** No real stocks are bought or sold. Trades execute at NAV *reference* prices, not market prices. Not investment advice.
- **Testnet only.** All onchain activity is on Base Sepolia. The B20 tokenized stocks live on Base mainnet; this demo never touches mainnet.
- **Zero traction (yet).** Launched 17 Nov 2026; no real users yet. Any usage shown is this demo's own paper activity.
- **NAV coverage is thin.** Only 12 of 377 tokens publish a NAV price, so only those 12 are tradeable by the agent. That is a data limitation, stated openly in the UI — the agent never invents a price.
- **The journal is public and append-only.** Anyone can log an entry; entries cannot be edited or deleted.

## Repo layout

```
index.html, app.js, styles.css   Static web app (GitHub Pages, no build step)
app/agent.js                     Shared agent logic (browser + Node, zero deps)
app/contract.json                TradeJournal ABI + bytecode (generated)
app/deployment.json              Base Sepolia deployment (added after deploy)
contracts/TradeJournal.sol       Onchain paper-trade journal
scripts/compile.js               Compile with solc (npm)
scripts/deploy.js                Deploy to Base Sepolia (or a local RPC)
scripts/test-local.js            Full E2E test: ganache + LIVE Tokenized Stocks API
```

## Run it

```bash
npm install
npm test            # local E2E: deploy on ganache, run agent on live API,
                    # log paper trades onchain, verify reason hashes + ERC-8021 suffix
node scripts/deploy.js   # deploy TradeJournal to Base Sepolia
                         # (needs testnet ETH in ~/.config/base-stocks-maxxing-deployer.key;
                         #  free from https://faucet.quicknode.com/base/sepolia)
```

Serve the app with any static server, e.g. `python3 -m http.server`, and open it.
No build step, no API keys.

## Builder Code

Agent Builder Code `bc_sijyqbvn`, registered via `POST https://api.base.dev/v1/agents/builder-codes`
(no auth) for the agent wallet `0x822bbE7174FC3E54cc278AD35dDE6532b2F8415B` (testnet-only throwaway wallet; its key is not in this repo).

## License

MIT — see [LICENSE](LICENSE).
