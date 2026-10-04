// Collector: every few minutes, read the pool's per-worker stats and turn them into mining hours
// and mined value per wallet (the input for the payout engine).
//   npx tsx services/collector/src/main.ts          run every `everyMinutes`
//   npx tsx services/collector/src/main.ts --once   one run, then exit
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_RULES } from "@hashcoin/engine";
import { gpuKey } from "@hashcoin/switcher";
import { collect, type CollectorState, type WorkerRecord } from "./collect.js";
import { fetchPoolInfo, fetchPriceUsd, fetchWorkers } from "./kryptex.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const readJson = <T>(path: string, fallback: T): T => {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
};

const cfg = readJson<{ everyMinutes: number; coins: Record<string, { kryptex: string; catalog: Record<string, number> }> }>(here("../config/collector.json"), { everyMinutes: 5, coins: {} });
const coins = readJson<{ coins: { id: string; payoutAddress?: string }[] }>(here("../../api/config/coins.json"), { coins: [] }).coins;
const registryPath = process.env.HASH_WORKER_REGISTRY ?? here("../../api/data/workers.json");
const dataDir = here("../data");
const statePath = (coin: string) => `${dataDir}/state-${coin}.json`;

async function runOnce() {
  mkdirSync(dataDir, { recursive: true });
  const registry = readJson<Record<string, WorkerRecord>>(registryPath, {});
  const report: Record<string, unknown> = { at: new Date().toISOString() };
  for (const [coin, c] of Object.entries(cfg.coins)) {
    const address = coins.find((x) => x.id === coin)?.payoutAddress;
    if (!address) { report[coin] = { skipped: "no payout address in services/api/config/coins.json" }; continue; }
    try {
      const [workers, pool, priceUsd] = await Promise.all([fetchWorkers(c.kryptex, address), fetchPoolInfo(c.kryptex), fetchPriceUsd(c.kryptex)]);
      const catalog = Object.fromEntries(Object.entries(c.catalog).map(([name, hs]) => [gpuKey(name), hs]));
      const prev = readJson<CollectorState | null>(statePath(coin), null);
      const r = collect({ coin, now: Date.now(), prev, workers, pool, priceUsd, registry, rules: DEFAULT_RULES, catalog });
      writeFileSync(statePath(coin), JSON.stringify(r.state));
      report[coin] = { priceUsd, workers: workers.length, unknownWorkers: r.unknownWorkers, wallets: r.wallets };
      console.log(`${coin}: ${workers.length} workers, ${r.wallets.length} wallets, ${r.unknownWorkers.length} unregistered (${r.unknownWorkers.join(", ")})`);
      for (const w of r.wallets) {
        console.log(`  ${w.wallet}: +${(w.hoursCredited * 60).toFixed(1)} min credited, ${w.hoursInWindow.toFixed(2)} h in window, mined ${w.minedCoins.toFixed(4)} ${coin} ($${w.minedUsd.toFixed(4)})`);
      }
    } catch (e) {
      report[coin] = { error: (e as Error).message };
      console.error(`${coin}: ${(e as Error).message}`);
    }
  }
  writeFileSync(`${dataDir}/latest.json`, JSON.stringify(report, null, 2));
}

await runOnce();
if (!process.argv.includes("--once")) setInterval(() => { runOnce().catch((e) => console.error(e)); }, cfg.everyMinutes * 60 * 1000);
