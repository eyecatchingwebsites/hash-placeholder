// One collector run: read the pool's per-worker stats and turn them into mining hours and mined
// value per wallet (the input for the payout engine). Used by `main.ts` on its own, and by the
// payout loop (services/payouts), which runs it in-process. Don't run both at once: each run
// credits the time since the previous one.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_RULES } from "@hashcoin/engine";
import { applyPayoutAddresses, type CoinInfo, gpuKey } from "@hashcoin/switcher";
import { collect, type CollectorState, type WalletResult, type WorkerRecord } from "./collect.js";
import { fetchEarned, fetchPoolInfo, fetchPriceUsd, fetchWorkers } from "./kryptex.js";
import { DEFAULT_TRUE_UP, trueUp } from "./trueup.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const readJson = <T>(path: string, fallback: T): T => {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
};

export const cfg = readJson<{ everyMinutes: number; trueUp?: Partial<typeof DEFAULT_TRUE_UP>; coins: Record<string, { kryptex: string; catalog: Record<string, number> }> }>(here("../config/collector.json"), { everyMinutes: 5, coins: {} });
// Same payout addresses as the API hands out (HASH_PAYOUT_ADDRESS_<COIN> overrides coins.json).
const coins = applyPayoutAddresses(readJson<{ coins: CoinInfo[] }>(here("../../api/config/coins.json"), { coins: [] }).coins, process.env, { production: process.env.HASH_NETWORK === "mainnet" }).coins;
const registryPath = process.env.HASH_WORKER_REGISTRY ?? here("../../api/data/workers.json");
const dataDir = process.env.HASH_COLLECTOR_DATA ?? here("../data");
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
      const now = Date.now();
      const r = collect({ coin, now, prev, workers, pool, priceUsd, registry, rules: DEFAULT_RULES, catalog });
      // True-up: what the pool actually credited vs what we estimated, over the last day.
      let earned: number | null = null, earnedError: string | undefined;
      try { earned = (await fetchEarned(c.kryptex, address)).earned; } catch (e) { earnedError = (e as Error).message; }
      const t = trueUp(prev?.trueUp, now, earned, r.estimatedCoins, { ...DEFAULT_TRUE_UP, ...(cfg.trueUp ?? {}) });
      r.state.trueUp = t.state;
      for (const w of r.wallets) {
        w.estimatedUsd = w.minedUsd;
        w.minedUsd *= t.ratio;
        w.minedCoins *= t.ratio;
      }
      writeFileSync(statePath(coin), JSON.stringify(r.state));
      const trueUpReport = { ratio: t.ratio, raw: t.raw, window: t.window, poolEarned: earned, estimatedThisRun: r.estimatedCoins, ...(t.flag ? { flag: t.flag } : {}), ...(earnedError ? { error: earnedError } : {}) };
      report[coin] = { priceUsd, workers: workers.length, unknownWorkers: r.unknownWorkers, wallets: r.wallets, trueUp: trueUpReport };
      if (log) console.log(`${coin}: ${workers.length} workers, ${r.wallets.length} wallets, ${r.unknownWorkers.length} unregistered (${r.unknownWorkers.join(", ")}); true-up x${t.ratio.toFixed(3)} (pool credited ${t.window.actual.toFixed(4)} vs ${t.window.estimated.toFixed(4)} estimated over the window)${t.flag ? `; ${t.flag}` : ""}`);
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
export { DEFAULT_TRUE_UP, trueUp, type TrueUpResult, type TrueUpState } from "./trueup.js";

/** The true-up per coin from a report (for alerts and the public record). */
export function trueUpsOf(report: CollectorReport): Record<string, { ratio: number; raw: number | null; flag?: string; error?: string }> {
  return Object.fromEntries(Object.entries(report).flatMap(([coin, c]) => (c && typeof c === "object" && "trueUp" in c ? [[coin, (c as { trueUp: { ratio: number; raw: number | null; flag?: string; error?: string } }).trueUp]] : [])));
}
