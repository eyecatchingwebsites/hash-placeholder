import { describe, expect, it } from "vitest";
import { DAY_MS, DEFAULT_RULES } from "@hashcoin/engine";
import { coinsPerHash, collect, sessionHashrate, type CollectorState, type WorkerRecord } from "../src/collect.js";
import { fetchWorkers, type KryptexPoolInfo, type KryptexWorker } from "../src/kryptex.js";

const T0 = 1_791_150_000_000;
const MIN = 60_000;
const TH = 1e12;
const pool: KryptexPoolInfo = { net_hashrate: 54e18, block_reward: 2282.4, block_time: 194, fee: 0.02 };
const registry: Record<string, WorkerRecord> = {
  "PRL:habc-0": { worker: "habc-0", coin: "PRL", wallet: "WalletA", rigId: "pc", gpuIndex: 0, gpu: "NVIDIA GeForce RTX 4070 SUPER", at: T0 },
  "PRL:habc-1": { worker: "habc-1", coin: "PRL", wallet: "WalletA", rigId: "pc", gpuIndex: 1, gpu: "NVIDIA GeForce RTX 4070", at: T0 },
  "PRL:hdef-0": { worker: "hdef-0", coin: "PRL", wallet: "WalletB", rigId: "x", gpuIndex: 0, gpu: "NVIDIA GeForce RTX 3060", at: T0 },
};
const catalog = { rtx4070super: 132.3 * TH, rtx4070: 115.5 * TH };

/** A worker that has been online since `openedMsAgo`, mining at `ths` TH/s. */
function worker(name: string, ths: number, now: number, openedMsAgo = 2 * 60 * MIN): KryptexWorker {
  const active = Math.min(openedMsAgo, 30 * MIN);
  return {
    worker: name, scheme: "pps", status: "online", opened_at: now - openedMsAgo, last_share: now - 10_000,
    valid: 10, stale: 0, invalid: 0, avg_hashrate_30m: String((ths * TH * active) / (30 * MIN)), avg_hashrate_3h: "0",
  };
}

const run = (now: number, workers: KryptexWorker[], prev: CollectorState | null) =>
  collect({ coin: "PRL", now, prev, workers, pool, priceUsd: 0.36, registry, rules: DEFAULT_RULES, catalog });

describe("collector", () => {
  it("corrects Kryptex's averages for a session that just started (real numbers from Oct 4)", () => {
    const w: KryptexWorker = { ...worker("x", 0, T0), opened_at: 1791149669725, avg_hashrate_30m: "30023997515803.3" };
    expect(sessionHashrate(w, 1791149669725 + 471_712) / TH).toBeCloseTo(114.6, 0);
    expect(sessionHashrate({ ...w, status: "offline" }, 1791149669725 + 471_712)).toBe(0);
  });

  it("credits a full-speed GPU's minutes and values what it mined", () => {
    const a = run(T0, [worker("habc-0", 130, T0)], null);
    expect(a.wallets[0]!.hoursCredited).toBe(0); // first run only sets the baseline
    const b = run(T0 + 5 * MIN, [worker("habc-0", 130, T0 + 5 * MIN)], a.state);
    const w = b.wallets[0]!;
    expect(w.wallet).toBe("WalletA");
    expect(w.hoursCredited * 60).toBeCloseTo(5);
    expect(w.minedCoins).toBeCloseTo(130 * TH * 300 * coinsPerHash(pool));
    expect(w.minedUsd).toBeCloseTo(w.minedCoins * 0.36);
  });

  it("slow mining counts for less, judged against the catalog benchmark for the model", () => {
    const a = run(T0, [worker("habc-0", 53, T0)], null); // 40% of a 4070 SUPER's 132 TH/s
    const b = run(T0 + 10 * MIN, [worker("habc-0", 53, T0 + 10 * MIN)], a.state);
    expect(b.wallets[0]!.gpus[0]!.credit).toBeCloseTo(0.5, 1);
    expect(b.wallets[0]!.hoursCredited * 60).toBeCloseTo(5, 0); // 10 minutes count as about 5
  });

  it("a wallet with two GPUs gets its best GPU's minutes, not the sum", () => {
    const now = T0 + 5 * MIN;
    const a = run(T0, [worker("habc-0", 130, T0), worker("habc-1", 20, T0)], null);
    const b = run(now, [worker("habc-0", 130, now), worker("habc-1", 20, now)], a.state);
    expect(b.wallets).toHaveLength(1);
    expect(b.wallets[0]!.hoursCredited * 60).toBeCloseTo(5);
    expect(b.wallets[0]!.gpus).toHaveLength(2);
  });

  it("lists unregistered workers and flags a card far faster than its claimed model", () => {
    const a = run(T0, [worker("hashcoin-test", 120, T0), worker("habc-1", 300, T0)], null);
    expect(a.unknownWorkers).toEqual(["hashcoin-test"]);
    expect(a.wallets[0]!.gpus[0]!.flagged).toMatch(/likely a different card/);
  });

  it("keeps 14 days of hours and caps a run after a collector outage", () => {
    const a = run(T0, [worker("hdef-0", 30, T0)], null);
    const b = run(T0 + 5 * MIN, [worker("hdef-0", 30, T0 + 5 * MIN)], a.state);
    const late = T0 + 15 * DAY_MS;
    const c = run(late, [worker("hdef-0", 30, late)], b.state);
    // The 5 minutes from two weeks ago dropped out; this run is capped at 15 minutes, not 15 days.
    expect(c.wallets[0]!.hoursInWindow * 60).toBeCloseTo(15);
  });

  it("reads every page of workers and stops when the API repeats itself", async () => {
    const pages: Record<string, string[]> = { "1": ["a", "b"], "2": ["c"], "3": [] };
    const fake = (async (url: string) => {
      const page = new URL(url).searchParams.get("page")!;
      const names = pages[page] ?? [];
      return new Response(JSON.stringify({ results: names.map((n) => ({ worker: n })) }));
    }) as typeof fetch;
    expect((await fetchWorkers("prl", "addr", fake)).map((w) => w.worker)).toEqual(["a", "b", "c"]);
    const ignoresPaging = (async () => new Response(JSON.stringify({ results: [{ worker: "a" }] }))) as typeof fetch;
    expect((await fetchWorkers("prl", "addr", ignoresPaging)).map((w) => w.worker)).toEqual(["a"]);
  });
});
