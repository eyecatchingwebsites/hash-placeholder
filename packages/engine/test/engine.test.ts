import { describe, expect, it } from "vitest";
import {
  DAY_MS, DEFAULT_RULES, HOUR_MS, applyBalanceChange, chestShares, computeHolderLevel, computeMinerLevel,
  holdClockMs, holderMinShare, holderProgress, runEpoch, runHolderPayout, settle, splitTax, splitTokens,
  type WalletState, type WeightInput,
} from "../src/index.js";

const price = { priceUsd: 0.001, decimals: 6 }; // $0.001 per token
const tokensFor = (usd: number) => BigInt(Math.round((usd / price.priceUsd) * 1e6));
const T0 = Date.UTC(2026, 9, 1);
const R = DEFAULT_RULES;

function wallet(usd: number, clockHours: number, address = "w"): WalletState {
  return { address, balance: tokensFor(usd), clockStartAt: usd > 0 ? T0 - clockHours * HOUR_MS : null };
}

describe("holder levels", () => {
  it("H1 at $50 with no clock, H2 at $500 + 24h, H3 at $2,500 + 72h", () => {
    expect(computeHolderLevel(wallet(49, 999), price, T0, R)).toBe(0);
    expect(computeHolderLevel(wallet(50, 0), price, T0, R)).toBe(1);
    expect(computeHolderLevel(wallet(500, 23.9), price, T0, R)).toBe(1);
    expect(computeHolderLevel(wallet(500, 24), price, T0, R)).toBe(2);
    expect(computeHolderLevel(wallet(2500, 71), price, T0, R)).toBe(2);
    expect(computeHolderLevel(wallet(2500, 72), price, T0, R)).toBe(3);
  });

  it("a dip drops the level and recovering restores it with no new wait", () => {
    const w = wallet(600, 48);
    expect(computeHolderLevel(w, { ...price, priceUsd: 0.0007 }, T0, R)).toBe(1);
    expect(computeHolderLevel(w, price, T0, R)).toBe(2);
  });

  it("selling shrinks the hold clock in proportion; buying never moves it", () => {
    let w: WalletState = { address: "w", balance: 0n, clockStartAt: null };
    w = applyBalanceChange(w, tokensFor(1000), T0);
    expect(w.clockStartAt).toBe(T0);
    w = applyBalanceChange(w, tokensFor(1000), T0 + 10 * HOUR_MS); // buying more
    expect(holdClockMs(w, T0 + 100 * HOUR_MS)).toBe(100 * HOUR_MS);
    w = applyBalanceChange(w, -tokensFor(500), T0 + 100 * HOUR_MS); // sell 25% of the bag
    expect(holdClockMs(w, T0 + 100 * HOUR_MS)).toBeCloseTo(75 * HOUR_MS);
    w = applyBalanceChange(w, -w.balance, T0 + 101 * HOUR_MS); // sell everything
    expect(w.clockStartAt).toBeNull();
    expect(holdClockMs(w, T0 + 200 * HOUR_MS)).toBe(0);
  });

  it("reports progress to the next holder level", () => {
    const p = holderProgress(wallet(300, 10), price, T0, R);
    expect(p.holderLevel).toBe(1);
    expect(p.usdToNextHolder).toBeCloseTo(200);
    expect(p.msToNextHolder).toBe(14 * HOUR_MS);
  });
});

describe("miner levels", () => {
  it("M2 needs 2 days mined and H1; M3 needs 5 days and H2", () => {
    expect(computeMinerLevel(7, 0, R)).toBe(1);
    expect(computeMinerLevel(1, 3, R)).toBe(1);
    expect(computeMinerLevel(2, 1, R)).toBe(2);
    expect(computeMinerLevel(7, 1, R)).toBe(2);
    expect(computeMinerLevel(4, 3, R)).toBe(2);
    expect(computeMinerLevel(5, 2, R)).toBe(3);
  });
});

describe("tax split", () => {
  it("dev 0.5%, miners get what reaches 5x, holders get the rest", () => {
    // $10,000 of trades -> $500 tax. Miners mined $50, so they need $200 more to reach 5x.
    const s = splitTax({ taxUsd: 500, minedUsd: 50 }, R);
    expect(s.devUsd).toBeCloseTo(50);
    expect(s.chestUsd).toBeCloseTo(200);
    expect(s.holderUsd).toBeCloseTo(250);
    expect(s.chestRate).toBeCloseTo(0.02);
    expect(s.targetMet).toBe(true);
  });

  it("caps the chest at 3.5% so holders always get at least 1%", () => {
    const s = splitTax({ taxUsd: 500, minedUsd: 1000 }, R);
    expect(s.chestUsd).toBeCloseTo(350);
    expect(s.holderUsd).toBeCloseTo(100);
    expect(s.targetMet).toBe(false);
    expect(holderMinShare(R)).toBeCloseTo(0.01);
  });

  it("counts chest carried from earlier epochs toward the target", () => {
    const s = splitTax({ taxUsd: 500, minedUsd: 50, chestCarryUsd: 150 }, R);
    expect(s.chestUsd).toBeCloseTo(50);
    expect(s.holderUsd).toBeCloseTo(400);
  });
});

describe("holder payout", () => {
  it("splits by bag x holder level, skips H0 and excluded wallets", () => {
    const wallets = [
      wallet(1000, 1, "h1"),      // H1, weight 1000
      wallet(1000, 30, "h2"),     // H2, weight 2000
      wallet(10, 100, "dust"),    // below H1
      wallet(1_000_000, 999, "pool"),
    ];
    const r = runHolderPayout({ now: T0, potUsd: 300, wallets, price, rules: { ...R, holder: { ...R.holder, walletCap: 0 } }, excluded: new Set(["pool"]) });
    const by = Object.fromEntries(r.lines.map((l) => [l.address, l]));
    expect(by.h1!.usd).toBeCloseTo(100);
    expect(by.h2!.usd).toBeCloseTo(200);
    expect(by.dust).toBeUndefined();
    expect(by.pool).toBeUndefined();
    expect(r.carryUsd).toBeCloseTo(0);
  });

  it("caps one wallet at 5% of the pot", () => {
    const wallets = [wallet(100_000, 999, "whale")];
    for (let i = 0; i < 40; i++) wallets.push(wallet(100, 1, "s" + i));
    const r = runHolderPayout({ now: T0, potUsd: 1000, wallets, price, rules: R });
    expect(r.lines.find((l) => l.address === "whale")!.usd).toBeCloseTo(50);
    expect(r.paidUsd).toBeCloseTo(1000);
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
    ["a", wallet(0, 0, "a")],          // H0
    ["b", wallet(100, 48, "b")],       // H1
    ["c", wallet(800, 480, "c")],      // H2
  ]);
  const earnings = new Map([["a", 0.05], ["b", 0.05], ["c", 0.05]]);
  const daysMined = new Map([["a", 7], ["b", 3], ["c", 7]]);
  const base = { epochId: "e1", now: T0, earnings, daysMined, wallets, price, chestUsd: 70, floatAvailableUsd: 1000, rules: { ...R, walletCap: 0 } };

  it("pays 75% of mining now, holds 25%, and splits the chest by miner level", () => {
    const r = runEpoch(base);
    const byAddr = Object.fromEntries(r.lines.map((l) => [l.address, l]));
    expect(byAddr.a!.level).toBe(1); // mined 7 days but holds nothing
    expect(byAddr.b!.level).toBe(2);
    expect(byAddr.c!.level).toBe(3);
    expect(byAddr.c!.holderLevel).toBe(2);
    expect(byAddr.a!.immediateUsd).toBeCloseTo(0.0375);
    expect(byAddr.a!.pendingUsd).toBeCloseTo(0.0125);
    expect(byAddr.a!.chestUsd).toBeCloseTo(10);
    expect(byAddr.b!.chestUsd).toBeCloseTo(20);
    expect(byAddr.c!.chestUsd).toBeCloseTo(40);
    expect(r.pending).toHaveLength(3);
    expect(r.carryUsd).toBeCloseTo(0);
  });

  it("never pays the chest to excluded wallets", () => {
    const r = runEpoch({ ...base, excluded: new Set(["c"]) });
    expect(r.lines.map((l) => l.address).sort()).toEqual(["a", "b"]);
    expect(r.totals.chestUsd).toBeCloseTo(70);
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
