// One collector run: read the pool's per-worker stats and turn them into mining hours and mined
// value per wallet (the input for the payout engine). Used by `main.ts` on its own, and by the
// payout loop (services/payouts), which runs it in-process. Don't run both at once: each run
// credits the time since the previous one.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_RULES } from "@hashcoin/engine";
import { gpuKey } from "@hashcoin/switcher";
import { collect, type CollectorState, type WalletResult, type WorkerRecord } from "./collect.js";
import { fetchPoolInfo, fetchPriceUsd, fetchWorkers } from "./kryptex.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const readJson = <T>(path: string, fallback: T): T => {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
};

export const cfg = readJson<{ everyMinutes: number; coins: Record<string, { kryptex: string; catalog: Record<string, number> }> }>(here("../config/collector.json"), { everyMinutes: 5, coins: {} });
const coins = readJson<{ coins: { id: string; payoutAddress?: string }[] }>(here("../../api/config/coins.json"), { coins: [] }).coins;
const registryPath = process.env.HASH_WORKER_REGISTRY ?? here("../../api/data/workers.json");
const dataDir = here("../data");
const statePath = (coin: string) => `${dataDir}/state-${coin}.json`;

export interface CollectorReport {
  at: string;
  [coin: string]: unknown;
}

/** Wallet results for every coin that collected (skipped and failed coins are left out). */
export function walletsOf(report: CollectorReport): WalletResult[] {
  return Object.values(report).flatMap((c) => (c && typeof c === "object" && Array.isArray((c as { wallets?: unknown }).wallets) ? (c as { wallets: WalletResult[] }).wallets : []));
}

export async function runCollector(log = true): Promise<CollectorReport> {
  mkdirSync(dataDir, { recursive: true });
  const registry = readJson<Record<string, WorkerRecord>>(registryPath, {});
  const report: CollectorReport = { at: new Date().toISOString() };
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
      if (log) console.log(`${coin}: ${workers.length} workers, ${r.wallets.length} wallets, ${r.unknownWorkers.length} unregistered (${r.unknownWorkers.join(", ")})`);
      for (const w of r.wallets) {
        if (log) console.log(`  ${w.wallet}: +${(w.hoursCredited * 60).toFixed(1)} min credited, ${w.hoursInWindow.toFixed(2)} h in window, mined ${w.minedCoins.toFixed(4)} ${coin} ($${w.minedUsd.toFixed(4)})`);
      }
    } catch (e) {
      report[coin] = { error: (e as Error).message };
      console.error(`${coin}: ${(e as Error).message}`);
    }
  }
  writeFileSync(`${dataDir}/latest.json`, JSON.stringify(report, null, 2));
  return report;
}


export type { WalletResult } from "./collect.js";
