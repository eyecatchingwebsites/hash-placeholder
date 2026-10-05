import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, HOUR_MS, type PriceContext } from "@hashcoin/engine";
import type { MintTx } from "@hashcoin/chain";
import { indexTransactions } from "../src/indexer.js";
import { dayKey, emptyLedger } from "../src/ledger.js";
import { decideRate } from "../src/rate.js";
import { commitRound, planRound } from "../src/round.js";

const price: PriceContext = { priceUsd: 0.05, decimals: 6 };
const T = (n: number) => BigInt(Math.round(n * 1e6)); // whole tokens → base units
const TREASURY = "Treasury1111111111111111111111111111111111";
const DEV = "Dev11111111111111111111111111111111111111111";
const POOL = "Pool1111111111111111111111111111111111111111";
const ALICE = "Alice111111111111111111111111111111111111111";
const BOB = "Bob11111111111111111111111111111111111111111";
const MINER = "Miner11111111111111111111111111111111111111";
const platform = new Set([TREASURY, DEV]);
const t0 = Date.UTC(2026, 9, 5, 12);
let n = 0;
const tx = (at: number, ...deltas: [string, number][]): MintTx =>
  ({ signature: `sig${++n}`, at, deltas: deltas.map(([owner, d]) => ({ owner, account: `${owner}-ata`, delta: T(d) })) });

const fresh = () => ({ ...emptyLedger("devnet", "mint"), startedAt: 0 });

describe("indexer", () => {
  it("builds balances and hold clocks from transfers, counting outside trades as volume", () => {
    const l = fresh();
    // Treasury seeds the pool (not volume); Alice buys 2,000 ($100) from the pool; Bob buys dust.
    const vol = indexTransactions(l, [
      tx(t0, [TREASURY, -1_000_000], [POOL, 1_000_000]),
      tx(t0 + 1000, [POOL, -2000], [ALICE, 1900]),
      tx(t0 + 2000, [POOL, -100], [BOB, 95]),
    ], { price, rules: DEFAULT_RULES, platform });
    expect(vol).toBe(T(2100));
    expect(l.days[dayKey(t0)]!.volumeTokens).toBeCloseTo(2100, 6);
    expect(l.wallets[TREASURY]).toBeUndefined();
    expect(l.wallets[ALICE]!.balance).toBe(T(1900).toString());
    expect(l.wallets[ALICE]!.clockMs).toBe(0); // $95 bag ≥ $50: clock starts
    expect(l.wallets[BOB]!.clockMs).toBeNull(); // $4.75: too small to start the clock
    expect(l.tokenAccounts).toContain(`${ALICE}-ata`);
    expect(l.lastSignature).toBe(`sig${n}`);
    expect(l.ownFeesUnharvested).toBe("0"); // the seed transfer had no fee in this example
  });

  it("marks fees on the treasury's own transfers to go back to the treasury, not the pot", () => {
    const l = fresh();
    indexTransactions(l, [tx(t0, [TREASURY, -1000], [ALICE, 950]), tx(t0 + 1, [ALICE, -100], [BOB, 95])], { price, rules: DEFAULT_RULES, platform });
    expect(l.ownFeesUnharvested).toBe(T(50).toString());
  });

  it("history from before the take-over rebuilds balances but isn't counted as trading", () => {
    const l = { ...emptyLedger("devnet", "mint"), startedAt: t0 };
    const vol = indexTransactions(l, [tx(t0 - 1000, [POOL, -2000], [ALICE, 1900]), tx(t0 - 500, [TREASURY, -100], [BOB, 95])], { price, rules: DEFAULT_RULES, platform });
    expect(vol).toBe(0n);
    expect(l.days).toEqual({});
    expect(l.ownFeesUnharvested).toBe("0");
    expect(l.wallets[ALICE]!.balance).toBe(T(1900).toString());
  });

  it("selling takes time off the clock (2.5× the share sold)", () => {
    const l = fresh();
    indexTransactions(l, [tx(t0, [ALICE, 2000])], { price, rules: DEFAULT_RULES, platform });
    indexTransactions(l, [tx(t0 + 10 * HOUR_MS, [ALICE, -200], [POOL, 190])], { price, rules: DEFAULT_RULES, platform });
    expect(l.wallets[ALICE]!.clockMs).toBeCloseTo(10 * HOUR_MS * 0.75, -3);
  });
});

describe("rate", () => {
  const cfg = { lookbackDays: 2, minIntervalHours: 24 };
  it("leaves the rate alone with no trading", () => {
    expect(decideRate(emptyLedger("d", "m"), { now: t0, priceUsd: 0.05, liveBps: 500 }, cfg, DEFAULT_RULES)).toBeNull();
  });
  it("lowers it when trading is busy, once a day at most", () => {
    const l = emptyLedger("d", "m");
    l.days[dayKey(t0)] = { volumeTokens: 750 / 0.05, minedUsd: 2.5, taxTokens: 0, paidTokens: 0 }; // $750 per GPU
    const d = decideRate(l, { now: t0, priceUsd: 0.05, liveBps: 500 }, cfg, DEFAULT_RULES);
    expect(d?.bps).toBe(275);
    expect(decideRate(l, { now: t0, priceUsd: 0.05, liveBps: 500, scheduledBps: 275 }, cfg, DEFAULT_RULES)).toBeNull();
    l.rateChanges.push({ at: t0 - HOUR_MS, bps: 300, reason: "" });
    expect(decideRate(l, { now: t0, priceUsd: 0.05, liveBps: 500, scheduledBps: 300 }, cfg, DEFAULT_RULES)).toBeNull();
  });
  it("goes to 5% when miners can't reach 5×", () => {
    const l = emptyLedger("d", "m");
    l.days[dayKey(t0)] = { volumeTokens: 100 / 0.05, minedUsd: 2.5, taxTokens: 0, paidTokens: 0 };
    expect(decideRate(l, { now: t0, priceUsd: 0.05, liveBps: 275 }, cfg, DEFAULT_RULES)?.bps).toBe(500);
  });
});

describe("round", () => {
  const base = { roundId: "r1", rateBps: 500, price, rules: DEFAULT_RULES, excluded: new Set([...platform, POOL]), dev: DEV, payHolders: true, settleAtEstimateAfterMs: 6 * HOUR_MS, minHolderPayoutUsd: 0.0001 };

  function ledgerWithHolderAndMiner() {
    const l = fresh();
    indexTransactions(l, [tx(t0 - 2 * 24 * HOUR_MS, [POOL, -20_000], [ALICE, 20_000])], { price, rules: DEFAULT_RULES, platform }); // $1,000, 2 days
    l.minedSinceRound[MINER] = 1;
    l.hoursInWindow[MINER] = 3;
    return l;
  }

  it("splits the tax, tops miners up, pays holders and dev, holds back 25% of mining", () => {
    const l = ledgerWithHolderAndMiner();
    const taxTokens = T(200); // $10
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens });
    expect(plan.taxUsd).toBeCloseTo(10, 9);
    expect(plan.split.shares.dev).toBeCloseTo(0.05, 9); // 5% of the tax at a 5% rate
    expect(plan.split.chestUsd).toBeCloseTo(4.5, 9); // 5× needs $4, but miners get at least 45% of the tax
    const miner = plan.payouts.find((p) => p.address === MINER)!;
    expect(miner.usd).toBeCloseTo(0.75 + 4.5, 9);
    const alice = plan.payouts.find((p) => p.address === ALICE)!;
    expect(alice.usd).toBeCloseTo(10 - 0.5 - 4.5, 9);
    expect(plan.payouts.find((p) => p.kind === "dev")!.usd).toBeCloseTo(0.5, 9);

    commitRound(l, plan, { now: t0, taxTokens, decimals: 6 }, plan.payouts.map((p) => T(p.usd / 0.05)));
    expect(l.round).toBe(1);
    expect(l.minedSinceRound).toEqual({});
    expect(l.pending).toHaveLength(1);
    expect(l.pending[0]!.estimatedUsd).toBeCloseTo(0.25, 9);
    expect(Number(l.totals.taxTokens)).toBe(Number(taxTokens));
  });

  it("owes failed payouts and pays them first next round; settles held-back mining once mature", () => {
    const l = ledgerWithHolderAndMiner();
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens: T(200) });
    const sent = plan.payouts.map((p) => (p.address === ALICE ? undefined : T(p.usd / 0.05)));
    commitRound(l, plan, { now: t0, taxTokens: T(200), decimals: 6 }, sent);
    expect(l.owed.map((o) => o.address)).toEqual([ALICE]);
    expect(l.paid[ALICE]).toBeUndefined();

    const later = t0 + 7 * HOUR_MS;
    const next = planRound({ ...base, ledger: l, now: later, taxTokens: 0n, payHolders: false });
    expect(next.payouts[0]!.address).toBe(ALICE);
    expect(next.payouts[0]!.why).toMatch(/^retry: /);
    const settled = next.payouts.find((p) => p.kind === "settle")!;
    expect(settled.address).toBe(MINER);
    expect(settled.usd).toBeCloseTo(0.25, 9);
    commitRound(l, next, { now: later, taxTokens: 0n, decimals: 6 }, next.payouts.map(() => 1n));
    expect(l.owed).toEqual([]);
    expect(l.pending).toEqual([]);
  });

  it("carries the bonus when nobody mined, and the holder pot when holders aren't paid this round", () => {
    const l = emptyLedger("devnet", "mint");
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens: T(200), payHolders: false });
    expect(plan.payouts.map((p) => p.kind)).toEqual(["dev"]);
    expect(plan.chestCarryUsd).toBeCloseTo(plan.split.chestUsd, 9);
    expect(plan.holderCarryUsd).toBeCloseTo(plan.split.holderUsd, 9);
  });
});
