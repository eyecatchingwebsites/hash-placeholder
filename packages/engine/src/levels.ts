import type { HolderLevel, Level, Rules } from "./rules.js";

/** The level price: the higher of the ~1h and ~7-day average prices. */
export function levelPriceUsd(avg1hUsd: number, avg7dUsd: number): number {
  return Math.max(avg1hUsd, avg7dUsd);
}

/** What the platform tracks per wallet. Token amounts are in base units. */
export interface WalletState {
  address: string;
  /** Current $HASH balance (base units), read from chain. */
  balance: bigint;
  /**
   * Start of the hold clock (ms epoch); the clock reads `now - clockStartAt`.
   * Starts when the bag first reaches the H1 size. Selling a fraction f of the bag shrinks the
   * clock by f. Buying never moves it. Null until then and while the wallet holds nothing.
   */
  clockStartAt: number | null;
}

export interface PriceContext {
  /**
   * USD per whole token for level thresholds: the higher of the ~1h and ~7-day averages,
   * so a crash takes about a week to drop anyone's level while a rise counts within the hour.
   */
  priceUsd: number;
  decimals: number;
}

export function positionUsd(balance: bigint, p: PriceContext): number {
  return (Number(balance) / 10 ** p.decimals) * p.priceUsd;
}

export function holdClockMs(w: WalletState, now: number): number {
  return w.clockStartAt === null ? 0 : Math.max(0, now - w.clockStartAt);
}

/**
 * Holder level: the highest of H1-H3 whose bag and hold clock are both met.
 * A dip below a bag threshold drops the level; recovering restores it at once,
 * because the clock keeps running through price moves.
 */
export function computeHolderLevel(w: WalletState, p: PriceContext, now: number, rules: Rules): HolderLevel {
  const usd = positionUsd(w.balance, p);
  const clock = holdClockMs(w, now);
  const [u1, u2, u3] = rules.holder.usd;
  const [c1, c2, c3] = rules.holder.clockMs;
  if (usd >= u3 && clock >= c3) return 3;
  if (usd >= u2 && clock >= c2) return 2;
  if (usd >= u1 && clock >= c1) return 1;
  return 0;
}

/**
 * Miner level: M1 for anyone mining; M2 and M3 need enough days mined in the window
 * and a holder level (M2 needs H1, M3 needs H2 by default).
 */
export function computeMinerLevel(daysMined: number, holderLevel: HolderLevel, rules: Rules): Level {
  const m = rules.miner;
  if (daysMined >= m.days[3] && holderLevel >= m.needsHolder[3]) return 3;
  if (daysMined >= m.days[2] && holderLevel >= m.needsHolder[2]) return 2;
  return 1;
}

/** Token amount (base units) worth the H1 bag at this price: the hold clock starts at this size. */
export function clockStartTokens(p: PriceContext, rules: Rules): bigint {
  if (p.priceUsd <= 0) return 0n;
  return BigInt(Math.ceil((rules.holder.usd[0] / p.priceUsd) * 10 ** p.decimals));
}

/**
 * Apply an observed on-chain balance change to the wallet state.
 * Any outflow counts as selling, including wallet-to-wallet transfers, LP and exchange deposits.
 * The clock starts with the first inflow that leaves the bag at `clockMin` or more (the H1 bag,
 * from `clockStartTokens`), so dust can't be parked early to pre-age a wallet.
 */
export function applyBalanceChange(w: WalletState, delta: bigint, at: number, clockMin = 0n): WalletState {
  const before = w.balance;
  const balance = before + delta < 0n ? 0n : before + delta;
  let clockStartAt = w.clockStartAt;
  if (balance === 0n) {
    clockStartAt = null;
  } else if (delta > 0n && clockStartAt === null) {
    if (balance >= clockMin) clockStartAt = at;
  } else if (delta < 0n && clockStartAt !== null && before > 0n) {
    const keptFraction = Number(balance) / Number(before);
    const clock = Math.max(0, at - clockStartAt);
    clockStartAt = at - clock * keptFraction;
  }
  return { ...w, balance, clockStartAt };
}

export interface LevelProgress {
  holderLevel: HolderLevel;
  /** USD still needed for the next holder level's bag (0 at H3). */
  usdToNextHolder: number;
  /** Hold-clock ms still needed for the next holder level (0 at H3 or if already met). */
  msToNextHolder: number;
}

export function holderProgress(w: WalletState, p: PriceContext, now: number, rules: Rules): LevelProgress {
  const holderLevel = computeHolderLevel(w, p, now, rules);
  if (holderLevel === 3) return { holderLevel, usdToNextHolder: 0, msToNextHolder: 0 };
  const i = holderLevel; // index of the next level's thresholds
  return {
    holderLevel,
    usdToNextHolder: Math.max(0, rules.holder.usd[i]! - positionUsd(w.balance, p)),
    msToNextHolder: Math.max(0, rules.holder.clockMs[i]! - holdClockMs(w, now)),
  };
}
