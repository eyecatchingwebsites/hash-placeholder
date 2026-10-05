import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSigningKey, newSigningKey, rawPublicKey } from "@hashcoin/switcher";
import { loadHashrateNoQuotes } from "./quotes.js";
import { createApi, type WorkerRecord } from "./server.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const cfg = JSON.parse(readFileSync(here("../config/coins.json"), "utf8"));
const minerManifest = JSON.parse(readFileSync(here("../config/miners.json"), "utf8"));
const quotes = loadHashrateNoQuotes(here("../../../data/hashrate-no-gpus-2026-10-03.json"));

// The signing key comes from the deploy environment. Never commit it. Without one, a throwaway dev
// key is kept in data/ (gitignored) so restarts don't change the key the dev app trusts.
let pem = process.env.HASH_SIGNING_KEY_PEM;
if (!pem) {
  const devKeyPath = here("../data/dev-signing-key.pem");
  try { pem = readFileSync(devKeyPath, "utf8"); } catch {
    pem = newSigningKey().privatePem;
    mkdirSync(here("../data"), { recursive: true });
    writeFileSync(devKeyPath, pem);
  }
  console.warn(`No HASH_SIGNING_KEY_PEM set: using the dev key in services/api/data. Public key: ${rawPublicKey(loadSigningKey(pem))}`);
}

// Worker → wallet map for the collector (services/collector). A file for now; Postgres later.
const registryPath = process.env.HASH_WORKER_REGISTRY ?? here("../data/workers.json");
const registry: Record<string, WorkerRecord> = (() => {
  try { return JSON.parse(readFileSync(registryPath, "utf8")); } catch { return {}; }
})();
let saveTimer: NodeJS.Timeout | undefined;
function remember(w: WorkerRecord) {
  registry[`${w.coin}:${w.worker}`] = w;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(here("../data"), { recursive: true });
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  }, 1000);
}

// The payout loop's public record (services/payouts), re-read on each request.
const publicPath = process.env.HASH_PUBLIC_RECORD ?? here("../../payouts/data/public.json");

const { server } = createApi({
  coins: cfg.coins, quotes, policy: cfg.policy, score: cfg.score, ttlMs: cfg.ttlMs,
  platformSell: () => ({}), // TODO: feed from the treasury's actual daily sell volume per coin
  minerManifest, signingKey: loadSigningKey(pem), kid: process.env.HASH_SIGNING_KID ?? "dev",
  onAssign: remember,
  publicRecord: () => {
    try { return JSON.parse(readFileSync(publicPath, "utf8")); } catch { return null; }
  },
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => console.log(`hashcoin api on :${port}`));
