import { describe, expect, it } from "vitest";
import {
  DAY_MS, DEFAULT_RULES, HOUR_MS, advanceClock, applyBalanceChange, chestShares, clockSpeed, clockStartTokens,
  computeHolderLevel, computeMinerLevel, holdClockMs, holderMinShare, holderProgress, levelPriceUsd, runEpoch,
  runHolderPayout, settle, splitTax, splitTokens, type WalletState, type WeightInput,
} from "../src/index.js";

const price = { priceUsd: 0.001, decimals: 6 }; // $0.001 per token
const tokensFor = (usd: number) => BigInt(Math.round((usd / price.priceUsd) * 1e6));
const T0 = Date.UTC(2026, 9, 1);
const R = DEFAULT_RULES;
const EMPTY: WalletState = { address: "w", balance: 0n, clockMs: null, clockAt: T0 };

function wallet(usd: number, clockHours: number, address = "w"): WalletState {
  return { address, balance: tokensFor(usd), clockMs: usd > 0 ? clockHours * HOUR_MS : null, clockAt: T0 };
}

describe("holder levels", () => {
  it("H1 at $50 with no clock, H2 at $500 + 24h, H3 at $2,500 + 7 days", () => {
    expect(computeHolderLevel(wallet(49, 999), price, T0, R)).toBe(0);
    expect(computeHolderLevel(wallet(50, 0), price, T0, R)).toBe(1);
    expect(computeHolderLevel(wallet(500, 23.9), price, T0, R)).toBe(1);
    expect(computeHolderLevel(wallet(500, 24), price, T0, R)).toBe(2);
    expect(computeHolderLevel(wallet(2500, 167), price, T0, R)).toBe(2);
    expect(computeHolderLevel(wallet(2500, 168), price, T0, R)).toBe(3);
  });

  it("a dip drops the level and recovering restores it with no new wait", () => {
    const w = wallet(600, 48);
    expect(computeHolderLevel(w, { ...price, priceUsd: 0.0007 }, T0, R)).toBe(1);
    expect(computeHolderLevel(w, price, T0, R)).toBe(2);
  });

  it("a bigger bag ticks faster: 1x up to $2,500, 2x at $5,000, at most 3x", () => {
    expect(clockSpeed(tokensFor(500), price, R)).toBe(1);
    expect(clockSpeed(tokensFor(2500), price, R)).toBe(1);
    expect(clockSpeed(tokensFor(5000), price, R)).toBeCloseTo(2);
    expect(clockSpeed(tokensFor(50000), price, R)).toBe(3);
    // $5,000 reaches H3's 7-day clock in 3.5 days, $7,500+ in about 2.3
    expect(computeHolderLevel(wallet(5000, 0), price, T0 + 3.5 * DAY_MS, R)).toBe(3);
    expect(computeHolderLevel(wallet(7500, 0), price, T0 + 2.3 * DAY_MS, R)).toBe(2);
    expect(computeHolderLevel(wallet(7500, 0), price, T0 + 2.34 * DAY_MS, R)).toBe(3);
  });

  it("buying more speeds the clock up from then on, never with a jump", () => {
    let w = applyBalanceChange(EMPTY, tokensFor(2500), T0, price, R);
    expect(holdClockMs(w, T0 + DAY_MS, price, R)).toBe(DAY_MS);
    w = applyBalanceChange(w, tokensFor(2500), T0 + DAY_MS, price, R); // now $5,000
    expect(w.clockMs).toBe(DAY_MS);
    expect(holdClockMs(w, T0 + 2 * DAY_MS, price, R)).toBeCloseTo(3 * DAY_MS);
  });

  it("selling takes 2.5x its share of the clock: 20% sold loses half, 40%+ resets", () => {
    const sell = (fraction: number) => {
      const w = wallet(4000, 100);
      return applyBalanceChange(w, -tokensFor(4000 * fraction), T0, price, R).clockMs;
    };
    expect(sell(0.05)).toBeCloseTo(87.5 * HOUR_MS);
    expect(sell(0.2)).toBeCloseTo(50 * HOUR_MS);
    expect(sell(0.4)).toBe(0);
    expect(sell(1)).toBeNull();
  });

  it("H3 for two weeks, sell 30%: back to H2 until the clock climbs past 7 days again", () => {
    let w = wallet(2500, 21 * 24); // H3 reached on day 7, held two more weeks
    expect(computeHolderLevel(w, price, T0, R)).toBe(3);
    w = applyBalanceChange(w, -tokensFor(750), T0, price, R); // sell 30% (bag now $1,750)
    expect(holdClockMs(w, T0, price, R)).toBeCloseTo(5.25 * DAY_MS); // lost 75%
    expect(computeHolderLevel(w, price, T0, R)).toBe(2);
    w = applyBalanceChange(w, tokensFor(1750), T0, price, R); // buy back to $3,500: bag is H3-sized
    expect(computeHolderLevel(w, price, T0, R)).toBe(2); // ...but the clock still needs 1.75 days
    expect(holderProgress(w, price, T0, R).msToNextHolder).toBeCloseTo((1.75 * DAY_MS) / 1.4); // at 1.4x
  });

  it("the clock only starts once the bag reaches the H1 size, so dust can't pre-age a wallet", () => {
    expect(clockStartTokens(price, R)).toBe(tokensFor(50));
    let w = applyBalanceChange(EMPTY, tokensFor(1), T0, price, R); // park $1 early
    expect(w.clockMs).toBeNull();
    w = applyBalanceChange(w, tokensFor(2500), T0 + 100 * HOUR_MS, price, R); // the real buy, days later
    expect(w.clockMs).toBe(0);
    expect(computeHolderLevel(w, price, T0 + 100 * HOUR_MS, R)).toBe(1);
  });

  it("advancing at each check lets the speed follow the price", () => {
    let w = applyBalanceChange(EMPTY, tokensFor(2500), T0, price, R);
    w = advanceClock(w, T0 + DAY_MS, price, R); // 1 day at 1x
    const doubled = { ...price, priceUsd: 0.002 }; // bag now worth $5,000 → 2x
    expect(holdClockMs(w, T0 + 2 * DAY_MS, doubled, R)).toBeCloseTo(3 * DAY_MS);
  });

  it("levels use the higher of the 1h and 7-day prices, so a crash doesn't drop levels at once", () => {
    expect(levelPriceUsd(0.0005, 0.001)).toBe(0.001);
    expect(levelPriceUsd(0.002, 0.001)).toBe(0.002);
  });

  it("reports progress to the next holder level", () => {
    const p = holderProgress(wallet(300, 10), price, T0, R);
    expect(p.holderLevel).toBe(1);
    expect(p.usdToNextHolder).toBeCloseTo(200);
    expect(p.msToNextHolder).toBe(14 * HOUR_MS);
    expect(p.speed).toBe(1);
  });
});

describe("miner levels", () => {
  it("M2 needs 48 hours mined and H1; M3 needs 120 hours and H2 (last 14 days)", () => {
    expect(R.miner.windowDays).toBe(14);
    expect(computeMinerLevel(300, 0, R)).toBe(1);
    expect(computeMinerLevel(47, 3, R)).toBe(1);
    expect(computeMinerLevel(48, 1, R)).toBe(2);
    expect(computeMinerLevel(300, 1, R)).toBe(2);
    expect(computeMinerLevel(119, 3, R)).toBe(2);
    expect(computeMinerLevel(120, 2, R)).toBe(3);
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
  const hoursMined = new Map([["a", 300], ["b", 60], ["c", 300]]);
  const base = { epochId: "e1", now: T0, earnings, hoursMined, wallets, price, chestUsd: 70, floatAvailableUsd: 1000, rules: { ...R, walletCap: 0 } };

  it("pays 75% of mining now, holds 25%, and splits the chest by miner level", () => {
    const r = runEpoch(base);
    const byAddr = Object.fromEntries(r.lines.map((l) => [l.address, l]));
    expect(byAddr.a!.level).toBe(1); // mined 300 hours but holds nothing
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
    expect(r.totals.buyUsd).toBeCloseTo(0.1125); // only mining is bought; the chest is already $HASH
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
