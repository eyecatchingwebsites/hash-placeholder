// Regenerate with: npx tsx apps/desktop/core/tests/fixtures/make-fixture.mjs
// Signs a sample assignment with a throwaway key using the server's signer, so the Rust
// tests check that the app accepts exactly what the server produces.
import { writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { rawPublicKey, signPayload } from "../../../../../packages/switcher/src/index.ts";

// Fresh key each run; only the public key and signature are written, the private key is discarded.
const key = generateKeyPairSync("ed25519").privateKey;
const wallet = "4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF";
const assignment = {
  v: 1, rigId: "gamingpc", wallet, gpuIndex: 0, gpu: "NVIDIA GeForce RTX 4070", coin: "PRL", algo: "pearlhash",
  minerId: "prl-miner", pool: { url: "stratum+tcp://prl-us.pool.invalid:3333", user: `${wallet}.gamingpc-0`, pass: "x" },
  expectedUsdPerDay: 2.9, reason: "start on PRL (best)", issuedAt: 1800000000000, expiresAt: 1800000900000,
};
const out = { kid: "test", public_key: rawPublicKey(key), wallet, envelope: signPayload(assignment, key, "test") };
writeFileSync(new URL("./assignment.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wrote assignment.json");
