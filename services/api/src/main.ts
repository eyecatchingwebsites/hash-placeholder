import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyPayoutAddresses, loadSigningKey, newSigningKey, rawPublicKey } from "@hashcoin/switcher";
import { loadHashrateNoQuotes } from "./quotes.js";
import { isLoopbackHost } from "./guard.js";
import { createApi, type WorkerRecord } from "./server.js";
import { fileWaitlist } from "./waitlist.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const cfg = JSON.parse(readFileSync(here("../config/coins.json"), "utf8"));
// The platform's payout address per coin comes from the deploy environment (HASH_PAYOUT_ADDRESS_<COIN>);
// on mainnet the test address in coins.json is refused.
const payout = applyPayoutAddresses(cfg.coins, process.env, { production: process.env.HASH_NETWORK === "mainnet" });
cfg.coins = payout.coins;
for (const n of payout.notes) console.log(n);
const minerManifest = JSON.parse(readFileSync(here("../config/miners.json"), "utf8"));
const quotes = loadHashrateNoQuotes(here("../../../data/hashrate-no-gpus-2026-10-03.json"));

const mainnet = process.env.HASH_NETWORK === "mainnet";

// The signing key comes from the deploy environment (the PEM itself, or a file outside the repo).
// Never commit it. Without one, a throwaway dev key is kept in data/ (gitignored) so restarts don't
// change the key the dev app trusts. On mainnet the dev key is refused.
let pem = process.env.HASH_SIGNING_KEY_PEM;
if (!pem && process.env.HASH_SIGNING_KEY_FILE) pem = readFileSync(process.env.HASH_SIGNING_KEY_FILE, "utf8");
if (!pem && mainnet) {
  console.error("HASH_NETWORK=mainnet needs the production signing key: set HASH_SIGNING_KEY_FILE (or HASH_SIGNING_KEY_PEM).");
  process.exit(1);
}
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

// The desktop app's update feed: the latest.json from the release workflow (see apps/desktop/README.md),
// re-read on each request. No file = no update offered.
const appUpdatePath = process.env.HASH_APP_UPDATE ?? here("../config/app-update.json");

// Price history for the app's charts: PRL from the Kryptex pool (hourly, last 30 days), cached for
// 10 minutes. $HASH has no market until launch, so it's null until then.
let priceCache: { at: number; body: unknown } | null = null;
async function prices() {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.body;
  const since = Date.now() - 30 * 24 * 3_600_000;
  let prl: [number, number][] = [];
  try {
    const r = await fetch("https://pool.kryptex.com/api/v1/coin/prl/price/chart", { signal: AbortSignal.timeout(10_000) });
    const pts = (await r.json()) as { timestamp: number; price: number }[];
    prl = pts.filter((p) => p.timestamp >= since && p.price > 0).map((p) => [p.timestamp, p.price]);
  } catch { /* keep the last good copy below */ }
  if (!prl.length && priceCache) return priceCache.body;
  const body = { updatedAt: new Date().toISOString(), prl: { source: "Kryptex pool", points: prl }, hash: null };
  priceCache = { at: Date.now(), body };
  return body;
}

// Website waitlist: personal data (X handles, emails), kept in data/ (gitignored). Never commit or publish it.
const waitlist = fileWaitlist(process.env.HASH_WAITLIST ?? here("../data/waitlist.jsonl"));
// The website origins allowed to post to the waitlist from a browser.
const siteOrigins = (process.env.HASH_SITE_ORIGINS ?? "https://hashcoin.app,https://www.hashcoin.app")
  .split(",").map((s) => s.trim()).filter(Boolean)
  .concat(mainnet ? [] : ["http://localhost:8123", "http://127.0.0.1:8123"]);

const { server } = createApi({
  coins: cfg.coins, quotes, policy: cfg.policy, score: cfg.score, ttlMs: cfg.ttlMs,
  platformSell: () => ({}), // TODO: feed from the treasury's actual daily sell volume per coin
  minerManifest, signingKey: loadSigningKey(pem), kid: process.env.HASH_SIGNING_KID ?? "dev",
  onAssign: remember,
  prices,
  publicRecord: () => {
    try { return JSON.parse(readFileSync(publicPath, "utf8")); } catch { return null; }
  },
  appUpdate: () => {
    try { return JSON.parse(readFileSync(appUpdatePath, "utf8")); } catch { return null; }
  },
  waitlist,
  siteOrigins,
});
// Localhost only by default: the public reaches it through the Cloudflare Tunnel (infra/tunnel),
// never through an open port on this PC or the router.
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
if (!isLoopbackHost(host)) console.warn(`HOST=${host}: the API is reachable from other machines, not just through the tunnel.`);
server.listen(port, host, () => console.log(`hashcoin api on http://${host.includes(":") ? `[${host}]` : host}:${port}`));
