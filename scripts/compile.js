// Compile contracts/TradeJournal.sol with solc (npm) and emit build artifacts:
//   build/TradeJournal.json  (abi + bytecode, for Node scripts)
//   app/contract.json        (same, for the browser app)
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const root = path.join(__dirname, "..");
const srcPath = path.join(root, "contracts", "TradeJournal.sol");
const source = fs.readFileSync(srcPath, "utf8");

const input = {
  language: "Solidity",
  sources: { "TradeJournal.sol": { content: source } },
  settings: {
    // Pin to Shanghai: the default (Osaka/Prague) emits opcodes local test
    // chains may not support. Base Sepolia supports Shanghai and newer.
    evmVersion: "shanghai",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
const contract = output.contracts["TradeJournal.sol"].TradeJournal;
const artifact = {
  contractName: "TradeJournal",
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
};

fs.mkdirSync(path.join(root, "build"), { recursive: true });
fs.writeFileSync(path.join(root, "build", "TradeJournal.json"), JSON.stringify(artifact, null, 2));
fs.writeFileSync(path.join(root, "app", "contract.json"), JSON.stringify(artifact, null, 2));
console.log("compiled TradeJournal: abi entries", artifact.abi.length, "| bytecode bytes", (artifact.bytecode.length - 2) / 2);
