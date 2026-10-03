import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSigningKey, newSigningKey } from "@hashcoin/switcher";
import { loadHashrateNoQuotes } from "./quotes.js";
import { createApi } from "./server.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const cfg = JSON.parse(readFileSync(here("../config/coins.json"), "utf8"));
const minerManifest = JSON.parse(readFileSync(here("../config/miners.json"), "utf8"));
const quotes = loadHashrateNoQuotes(here("../../../data/hashrate-no-gpus-2026-10-03.json"));

// The signing key comes from the deploy environment. Never commit it.
let pem = process.env.HASH_SIGNING_KEY_PEM;
if (!pem) {
  const k = newSigningKey();
  pem = k.privatePem;
  console.warn(`No HASH_SIGNING_KEY_PEM set. Using a throwaway dev key. Public key: ${k.publicRawB64}`);
}

const { server } = createApi({
  coins: cfg.coins, quotes, policy: cfg.policy, score: cfg.score, ttlMs: cfg.ttlMs,
  platformSell: () => ({}), // TODO: feed from the treasury's actual daily sell volume per coin
  minerManifest, signingKey: loadSigningKey(pem), kid: process.env.HASH_SIGNING_KID ?? "dev",
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => console.log(`hashcoin api on :${port}`));
