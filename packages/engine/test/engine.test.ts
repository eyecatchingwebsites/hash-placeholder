import { describe, expect, it } from "vitest";
import {
  DAY_MS, DEFAULT_RULES, applyBalanceChange, chestShares, computeLevel, levelProgress,
  runEpoch, settle, splitTokens, type WalletState, type WeightInput,
} from "../src/index.js";

const price = { priceUsd: 0.001, decimals: 6 }; // $0.001 per token
const tokensFor = (usd: number) => BigInt(Math.round((usd / price.priceUsd) * 1e6));
const T0 = Date.UTC(2026, 9, 1);
const R = DEFAULT_RULES;

function wallet(usd: number, ageDays: number, everSold = false): WalletState {
  return { address: "w", balance: tokensFor(usd), firstHashAt: T0 - ageDays * DAY_MS, everSold };
}

describe("levels", () => {
  it("L1 below $50, L2 at $50", () => {
    expect(computeLevel(wallet(49, 30), price, T0, R)).toBe(1);
    expect(computeLevel(wallet(50, 0), price, T0, R)).toBe(2);
  });

  it("L3 needs $500, 14 days since first $HASH, and no sells", () => {
    expect(computeLevel(wallet(500, 14), price, T0, R)).toBe(3);
    expect(computeLevel(wallet(500, 13.9), price, T0, R)).toBe(2);
    expect(computeLevel(wallet(5000, 60, true), price, T0, R)).toBe(2);
  });

  it("dropping below $500 falls to L2 and recovering restores L3 without a new wait", () => {
    const w = wallet(600, 20);
    expect(computeLevel(w, { ...price, priceUsd: 0.0007 }, T0, R)).toBe(2);
    expect(computeLevel(w, price, T0, R)).toBe(3);
  });

  it("any outflow permanently closes L3; inflows start the clock", () => {
    let w: WalletState = { address: "w", balance: 0n, firstHashAt: null, everSold: false };
    w = applyBalanceChange(w, tokensFor(600), T0);
    expect(w.firstHashAt).toBe(T0);
    w = applyBalanceChange(w, -1n, T0 + DAY_MS);
    expect(w.everSold).toBe(true);
    w = applyBalanceChange(w, tokensFor(1000), T0 + 2 * DAY_MS);
    expect(computeLevel(w, price, T0 + 30 * DAY_MS, R)).toBe(2);
    expect(levelProgress(w, price, T0 + 30 * DAY_MS, R).msToL3).toBeNull();
  });

  it("reports progress to the next level", () => {
    const p = levelProgress(wallet(30, 3), price, T0, R);
    expect(p.level).toBe(1);
    expect(p.usdToNext).toBeCloseTo(20);
    expect(p.msToL3).toBe(11 * DAY_MS);
  });
});

describe("chest shares", () => {
  it("weights by sqrt(earnings) × level multiplier", () => {
    const s = chestShares([
      { address: "a", earningsUsd: 1, level: 1 },
      { address: "b", earningsUsd: 4, level: 1 },
      { address: "c", earningsUsd: 1, level: 3 },
    ], { ...R, walletCap: 0 });
    // weights 1, 2, 4 -> shares 1/7, 2/7, 4/7
    expect(s.get("a")).toBeCloseTo(1 / 7);
    expect(s.get("b")).toBeCloseTo(2 / 7);
    expect(s.get("c")).toBeCloseTo(4 / 7);
  });

  it("caps a wallet and redistributes the excess", () => {
    const inputs: WeightInput[] = [{ address: "whale", earningsUsd: 10000, level: 3 }];
    for (let i = 0; i < 50; i++) inputs.push({ address: "m" + i, earningsUsd: 2, level: 1 });
    const s = chestShares(inputs, R);
    expect(s.get("whale")).toBeCloseTo(0.05);
    const total = [...s.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
  });

  it("leaves chest undistributed when every wallet is capped", () => {
    const s = chestShares([{ address: "a", earningsUsd: 3, level: 2 }], R);
    expect(s.get("a")).toBeCloseTo(0.05);
  });
});

describe("epoch", () => {
  const wallets = new Map<string, WalletState>([
    ["a", { ...wallet(0, 0), address: "a" }],
    ["b", { ...wallet(100, 2), address: "b" }],
    ["c", { ...wallet(800, 20), address: "c" }],
  ]);
  const earnings = new Map([["a", 0.05], ["b", 0.05], ["c", 0.05]]);
  const base = { epochId: "e1", now: T0, earnings, wallets, price, chestUsd: 70, floatAvailableUsd: 1000, rules: { ...R, walletCap: 0 } };

  it("pays 75% of mining now, holds 25%, and splits the chest by level", () => {
    const r = runEpoch(base);
    const byAddr = Object.fromEntries(r.lines.map((l) => [l.address, l]));
    expect(byAddr.a!.level).toBe(1);
    expect(byAddr.b!.level).toBe(2);
    expect(byAddr.c!.level).toBe(3);
    expect(byAddr.a!.immediateUsd).toBeCloseTo(0.0375);
    expect(byAddr.a!.pendingUsd).toBeCloseTo(0.0125);
    expect(byAddr.a!.chestUsd).toBeCloseTo(10);
    expect(byAddr.b!.chestUsd).toBeCloseTo(20);
    expect(byAddr.c!.chestUsd).toBeCloseTo(40);
    expect(r.pending).toHaveLength(3);
    expect(r.carryUsd).toBeCloseTo(0);
  });

  it("scales immediate payouts down to what the float holds", () => {
    const r = runEpoch({ ...base, floatAvailableUsd: 0.05625 }); // half of 0.1125
    expect(r.totals.immediateUsd).toBeCloseTo(0.05625);
    expect(r.totals.pendingUsd).toBeCloseTo(0.15 - 0.05625);
  });

  it("carries chest that the wallet cap leaves undistributed", () => {
    const r = runEpoch({ ...base, rules: R });
    expect(r.carryUsd).toBeCloseTo(70 * 0.85);
  });
});

describe("settlement", () => {
  const records = [
    { epochId: "e", address: "a", estimatedUsd: 0.25, miningUsd: 1, immediateUsd: 0.75 },
    { epochId: "e", address: "b", estimatedUsd: 0.75, miningUsd: 3, immediateUsd: 2.25 },
  ];

  it("pays the remainder when proceeds match the estimate", () => {
    const s = settle(records, 4);
    expect(s.lines[0]!.payUsd).toBeCloseTo(0.25);
    expect(s.lines[1]!.payUsd).toBeCloseTo(0.75);
  });

  it("trues up to actual proceeds and absorbs overpayment", () => {
    const s = settle(records, 2); // coin sold for half the estimate
    expect(s.ratio).toBeCloseTo(0.5);
    expect(s.totalPayUsd).toBeCloseTo(0);
    expect(s.totalOverpaidUsd).toBeCloseTo(1);
  });
});

describe("token split", () => {
  it("sums exactly to tokens bought and is proportional", () => {
    const { transfers } = splitTokens([{ address: "a", usd: 1 }, { address: "b", usd: 2 }], 1000n);
    expect(transfers.reduce((a, t) => a + t.amount, 0n)).toBe(1000n);
    expect(transfers.find((t) => t.address === "b")!.amount).toBeGreaterThanOrEqual(666n);
  });

  it("defers transfers below the minimum", () => {
    const { transfers, deferred } = splitTokens([{ address: "a", usd: 1000 }, { address: "b", usd: 0.001 }], 1_000_000n, 10n);
    expect(transfers.map((t) => t.address)).toEqual(["a"]);
    expect(deferred.map((d) => d.address)).toEqual(["b"]);
  });
});
