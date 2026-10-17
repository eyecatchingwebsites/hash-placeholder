// A new keypair file (solana-keygen's format: a JSON array of 64 numbers) for the launch wallets.
// Refuses to overwrite a file and refuses paths inside the repository, so a key can't be lost or committed.
//
//   npx tsx packages/chain/scripts/keygen.ts C:\Users\<you>\.hashcoin\payout.json
//
// Prints the address. Back the file up offline (a USB stick): whoever has it controls the wallet.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const file = process.argv[2];
if (!file) { console.error("usage: keygen.ts <keypair file outside the repository>"); process.exit(1); }
const path = resolve(file);
const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const rel = relative(repo, path);
if (!rel.startsWith("..") && !isAbsolute(rel)) { console.error(`${path} is inside the repository: keep keys outside it (e.g. C:\\Users\\<you>\\.hashcoin\\)`); process.exit(1); }
if (existsSync(path)) { console.error(`${path} already exists: not overwriting a key`); process.exit(1); }
mkdirSync(dirname(path), { recursive: true });
const k = Keypair.generate();
writeFileSync(path, JSON.stringify([...k.secretKey]), { flag: "wx" });
console.log(`${k.publicKey.toBase58()}  (saved to ${path})`);
