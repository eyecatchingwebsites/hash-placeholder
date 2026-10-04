import { DAY_MS, HOUR_MS, hourCredit, type Rules } from "@hashcoin/engine";
import { gpuKey } from "@hashcoin/switcher";
import type { KryptexPoolInfo, KryptexWorker } from "./kryptex.js";

/** What the API recorded for each pool worker (services/api WorkerRecord). */
export interface WorkerRecord {
  worker: string;
  coin: string;
  wallet: string;
  rigId: string;
  gpuIndex: number;
  gpu: string;
  at: number;
}

/** Carried between runs (a file for now; Postgres later). */
export interface CollectorState {
  at: number;
  /** Per worker ("COIN:worker"): recent hashrate samples and its best 3-hour average this week. */
  workers: Record<string, { since: number; samples: { at: number; hs: number }[]; best: { at: number; hs: number }[] }>;
  /** Per wallet: credited mining hours by run, kept for the M-level window. */
  hours: Record<string, { at: number; h: number }[]>;
}

export interface WalletResult {
  wallet: string;
  /** Mining hours credited this run (clock time with a GPU mining, scaled for slow mining). */
  hoursCredited: number;
  /** Credited hours in the M-level window (rules.miner.windowDays), this run included. */
  hoursInWindow: number;
  minedCoins: number;
  minedUsd: number;
  gpus: { worker: string; gpu: string; hashrate: number; expected: number; credit: number; flagged?: string }[];
}

export interface CollectInput {
  coin: string;
  now: number;
  prev: CollectorState | null;
  workers: KryptexWorker[];
  pool: KryptexPoolInfo;
  priceUsd: number;
  registry: Record<string, WorkerRecord>;
  rules: Rules;
  /** Benchmark hashrate (H/s) for a GPU model on this coin, if known (`gpuKey` names). */
  catalog?: Record<string, number>;
}

export interface CollectResult {
  state: CollectorState;
  wallets: WalletResult[];
  /** Workers under our payout address that no assignment explains (old sessions, manual tests). */
  unknownWorkers: string[];
}

const SAMPLE_WINDOW_MS = 3 * HOUR_MS;
/**
 * A session's first hour gets full credit without being judged: a mid-range card sends only a few
 * shares in that time, so the pool's estimate is mostly luck (live test: 51 TH/s reported for a card
 * doing 125). Samples from that hour aren't kept either.
 */
const WARMUP_MS = HOUR_MS;
const BEST_WINDOW_MS = 7 * DAY_MS;
const FLAG_ABOVE_CATALOG = 1.5;
/** Longest gap one run may credit, so a collector outage doesn't hand out hours nobody earned. */
const MAX_RUN_MS = 15 * 60 * 1000;

/**
 * The worker's current hashrate (H/s). Kryptex averages count the time before the session started
 * as zero, so a worker 8 minutes in shows a quarter of its 30-minute rate; scale by the time it has
 * actually been running.
 */
export function sessionHashrate(w: KryptexWorker, now: number): number {
  const h30 = Number(w.avg_hashrate_30m) || 0;
  const activeMs = now - w.opened_at;
  if (activeMs <= 0 || w.status !== "online") return 0;
  return activeMs < 30 * 60 * 1000 ? (h30 * 30 * 60 * 1000) / activeMs : h30;
}

/** Coins earned per hash under PPS+: block reward ÷ network hashes per block, minus the pool fee. */
export function coinsPerHash(pool: KryptexPoolInfo): number {
  if (!(pool.net_hashrate > 0) || !(pool.block_time > 0)) return 0;
  return (pool.block_reward / (pool.net_hashrate * pool.block_time)) * (1 - pool.fee);
}

/**
 * One collector run for one coin: map pool workers to wallets, credit mining hours (full at 80%+
 * of the GPU's expected rate, judged on its 3-hour average), and estimate what each wallet mined.
 */
export function collect(x: CollectInput): CollectResult {
  const prevAt = x.prev?.at ?? x.now;
  const runMs = Math.min(MAX_RUN_MS, Math.max(0, x.now - prevAt));
  const runH = runMs / HOUR_MS;
  const perHash = coinsPerHash(x.pool);
  const state: CollectorState = { at: x.now, workers: {}, hours: { ...(x.prev?.hours ?? {}) } };
  const byWallet = new Map<string, WalletResult>();
  const unknownWorkers: string[] = [];

  for (const w of x.workers) {
    const key = `${x.coin}:${w.worker}`;
    const rec = x.registry[key];
    if (!rec) { unknownWorkers.push(w.worker); continue; }

    const hs = sessionHashrate(w, x.now);
    const old = x.prev?.workers[key];
    // Start of this worker's current mining streak: kept across runs, reset when it goes offline.
    const since = hs > 0 ? Math.min(old?.since ?? x.now, w.opened_at || x.now) : x.now;
    const warmingUp = x.now - since < WARMUP_MS;
    const samples = [...(old?.samples ?? []), ...(warmingUp || hs <= 0 ? [] : [{ at: x.now, hs }])].filter((s) => s.at > x.now - SAMPLE_WINDOW_MS);
    const avg3h = samples.length ? samples.reduce((a, s) => a + s.hs, 0) / samples.length : hs;
    const best = [...(old?.best ?? []), ...(samples.length ? [{ at: x.now, hs: avg3h }] : [])].filter((s) => s.at > x.now - BEST_WINDOW_MS);
    state.workers[key] = { since, samples, best };

    // Expected rate: the card's own best 3-hour average this week, or the catalog benchmark for its
    // model if that's higher (so a card throttled from day one isn't its own yardstick).
    const catalogHs = x.catalog?.[gpuKey(rec.gpu)];
    const ownBest = best.length ? Math.max(...best.map((s) => s.hs)) : avg3h;
    const expected = Math.max(ownBest, catalogHs ?? 0);
    const mining = hs > 0 && w.last_share > prevAt - 30 * 60 * 1000;
    const credit = !mining ? 0 : warmingUp || !samples.length ? 1 : hourCredit(avg3h, expected, x.rules);
    const flagged = catalogHs && avg3h > FLAG_ABOVE_CATALOG * catalogHs
      ? `runs at ${(avg3h / catalogHs).toFixed(1)}x the ${rec.gpu} benchmark: likely a different card` : undefined;

    const r = byWallet.get(rec.wallet) ?? { wallet: rec.wallet, hoursCredited: 0, hoursInWindow: 0, minedCoins: 0, minedUsd: 0, gpus: [] };
    // Hours count while at least one GPU mines, so the wallet takes its best GPU's credit.
    r.hoursCredited = Math.max(r.hoursCredited, runH * credit);
    const coins = hs * (runMs / 1000) * perHash;
    r.minedCoins += coins;
    r.minedUsd += coins * x.priceUsd;
    r.gpus.push({ worker: w.worker, gpu: rec.gpu, hashrate: avg3h, expected, credit, ...(flagged ? { flagged } : {}) });
    byWallet.set(rec.wallet, r);
  }

  const windowStart = x.now - x.rules.miner.windowDays * DAY_MS;
  for (const r of byWallet.values()) {
    const kept = (state.hours[r.wallet] ?? []).filter((e) => e.at > windowStart);
    if (r.hoursCredited > 0) kept.push({ at: x.now, h: r.hoursCredited });
    state.hours[r.wallet] = kept;
    r.hoursInWindow = kept.reduce((a, e) => a + e.h, 0);
  }
  for (const [wallet, entries] of Object.entries(state.hours)) {
    const kept = entries.filter((e) => e.at > windowStart);
    if (kept.length) state.hours[wallet] = kept; else delete state.hours[wallet];
  }
  return { state, wallets: [...byWallet.values()], unknownWorkers };
}
