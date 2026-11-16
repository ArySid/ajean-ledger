// Generates two THROWAWAY Base Sepolia testnet wallets and writes them to .env.local (gitignored).
// Never prints private keys. Never use these wallets on mainnet.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const path = ".env.local";
if (existsSync(path) && readFileSync(path, "utf8").includes("AGENT_PRIVATE_KEY=0x")) {
  console.log(".env.local already has wallets — not overwriting.");
  process.exit(0);
}
const serviceKey = generatePrivateKey();
const agentKey = generatePrivateKey();
const service = privateKeyToAccount(serviceKey);
const agent = privateKeyToAccount(agentKey);
const env = readFileSync(".env.example", "utf8")
  .replace(/SERVICE_PAY_TO_ADDRESS=.*/, `SERVICE_PAY_TO_ADDRESS=${service.address}\n# Service wallet key kept only to sweep test funds later; the server never needs it.\nSERVICE_PRIVATE_KEY=${serviceKey}`)
  .replace(/AGENT_PRIVATE_KEY=.*/, `AGENT_PRIVATE_KEY=${agentKey}\nAGENT_ADDRESS=${agent.address}`);
writeFileSync(path, env, { mode: 0o600 });
console.log("Service payTo address:", service.address);
console.log("Demo agent address:   ", agent.address);
