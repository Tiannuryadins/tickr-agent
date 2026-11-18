// Deploy TradeJournal to a network (Base Sepolia by default, or a local RPC).
// Usage:
//   node scripts/deploy.js                    -> Base Sepolia via public RPC
//   node scripts/deploy.js http://127.0.0.1:8545  -> local chain (ganache/anvil)
// Deployer key: read from ~/.config/base-stocks-maxxing-deployer.key (mode 600,
// testnet-only throwaway wallet). For a local chain, the key file is ignored and
// the first ganache account is used if the file is absent.
// Writes deployment info to deployments/<chainId>.json and app/deployment.json.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const root = path.join(__dirname, "..");
const artifact = require(path.join(root, "build", "TradeJournal.json"));

const RPC_URL = process.argv[2] || "https://sepolia.base.org";
const KEY_PATH = path.join(os.homedir(), ".config", "base-stocks-maxxing-deployer.key");

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  console.log("network chainId:", network.chainId.toString(), "| rpc:", RPC_URL);

  let wallet;
  if (fs.existsSync(KEY_PATH)) {
    wallet = new ethers.Wallet(fs.readFileSync(KEY_PATH, "utf8").trim(), provider);
  } else {
    // Local test chain fallback: ganache default first account.
    wallet = new ethers.Wallet(
      "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
      provider
    );
  }
  console.log("deployer:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("balance:", ethers.formatEther(balance), "ETH");
  if (balance === 0n) {
    console.error("ERROR: deployer has 0 ETH. Fund it from a Base Sepolia faucet first (free).");
    console.error("Faucet options: https://faucet.quicknode.com/base/sepolia (no account),");
    console.error("  https://www.alchemy.com/faucets/base-sepolia (needs mainnet history).");
    process.exit(2);
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  console.log("deploy tx:", contract.deploymentTransaction().hash);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = await contract.deploymentTransaction().wait();
  console.log("TradeJournal deployed at:", address, "| block:", receipt.blockNumber);

  const out = {
    chainId: Number(network.chainId),
    rpc: RPC_URL,
    address,
    deployer: wallet.address,
    deployTx: contract.deploymentTransaction().hash,
    deployBlock: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    explorer: `https://sepolia.basescan.org/address/${address}`,
  };
  const depDir = path.join(root, "deployments");
  fs.mkdirSync(depDir, { recursive: true });
  fs.writeFileSync(path.join(depDir, `${out.chainId}.json`), JSON.stringify(out, null, 2));
  if (Number(network.chainId) === 84532) {
    fs.writeFileSync(path.join(root, "app", "deployment.json"), JSON.stringify(out, null, 2));
  }
  console.log("saved deployments/" + out.chainId + ".json");
}

main().catch((e) => {
  console.error("deploy failed:", e.message || e);
  process.exit(1);
});
