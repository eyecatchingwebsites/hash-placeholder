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
   * Hold clock (ms of clock time) as of `clockAt`. It ticks at the bag's clock speed (1× to 3×),
   * so it can run ahead of real time. Starts when the bag first reaches the H1 size; selling takes
   * time off. Null until then and after selling everything.
   */
  clockMs: number | null;
  /** When `clockMs` was last brought up to date (ms epoch). */
  clockAt: number;
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

/** How fast the hold clock runs for a bag: bag ÷ `speedPerUsd`, between 1× and `maxSpeed`×. */
export function clockSpeed(balance: bigint, p: PriceContext, rules: Rules): number {
  const h = rules.holder;
  return Math.min(h.maxSpeed, Math.max(1, positionUsd(balance, p) / h.speedPerUsd));
}

/**
 * The hold clock at `now`, ticking at the current bag's speed since `clockAt`. Callers bring the
 * clock up to date at every balance change and payout check, so a price move only affects the
 * speed from the next check on.
 */
export function holdClockMs(w: WalletState, now: number, p: PriceContext, rules: Rules): number {
  if (w.clockMs === null) return 0;
  return w.clockMs + Math.max(0, now - w.clockAt) * clockSpeed(w.balance, p, rules);
}

/** Bring the stored clock up to `now` (call at each payout check so speed follows the price). */
export function advanceClock(w: WalletState, now: number, p: PriceContext, rules: Rules): WalletState {
  if (w.clockMs === null) return { ...w, clockAt: now };
  return { ...w, clockMs: holdClockMs(w, now, p, rules), clockAt: now };
}

/**
 * Holder level: the highest of H1-H3 whose bag and hold clock are both met.
 * A dip below a bag threshold drops the level; recovering restores it at once,
 * because the clock keeps running through price moves.
 */
export function computeHolderLevel(w: WalletState, p: PriceContext, now: number, rules: Rules): HolderLevel {
  const usd = positionUsd(w.balance, p);
  const clock = holdClockMs(w, now, p, rules);
  const [u1, u2, u3] = rules.holder.usd;
  const [c1, c2, c3] = rules.holder.clockMs;
  if (usd >= u3 && clock >= c3) return 3;
  if (usd >= u2 && clock >= c2) return 2;
  if (usd >= u1 && clock >= c1) return 1;
  return 0;
}

/**
 * Miner level: M1 for anyone mining; M2 and M3 need enough hours mined in the window
 * and a holder level (M2 needs H1, M3 needs H2 by default).
 */
export function computeMinerLevel(hoursMined: number, holderLevel: HolderLevel, rules: Rules): Level {
  const m = rules.miner;
  if (hoursMined >= m.hours[3] && holderLevel >= m.needsHolder[3]) return 3;
  if (hoursMined >= m.hours[2] && holderLevel >= m.needsHolder[2]) return 2;
  return 1;
}

/** Token amount (base units) worth the H1 bag at this price: the hold clock starts at this size. */
export function clockStartTokens(p: PriceContext, rules: Rules): bigint {
  if (p.priceUsd <= 0) return 0n;
  return BigInt(Math.ceil((rules.holder.usd[0] / p.priceUsd) * 10 ** p.decimals));
}

/**
 * Apply an observed on-chain balance change to the wallet state.
 * - The clock is first brought up to `at` at the old bag's speed.
 * - It starts with the first inflow that leaves the bag at the H1 size or more, so dust can't be
 *   parked early to pre-age a wallet. Buying more never moves it, but a bigger bag ticks faster.
 * - Any outflow counts as selling, including wallet-to-wallet transfers, LP and exchange deposits.
 *   Selling a fraction s of the bag takes `sellPenalty` × s of the clock; selling everything resets it.
 */
export function applyBalanceChange(w: WalletState, delta: bigint, at: number, p: PriceContext, rules: Rules): WalletState {
  const now = advanceClock(w, at, p, rules);
  const before = now.balance;
  const balance = before + delta < 0n ? 0n : before + delta;
  let clockMs = now.clockMs;
  if (balance === 0n) {
    clockMs = null;
  } else if (delta > 0n && clockMs === null) {
    if (balance >= clockStartTokens(p, rules)) clockMs = 0;
  } else if (delta < 0n && clockMs !== null && before > 0n) {
    const soldFraction = Number(before - balance) / Number(before);
    clockMs *= Math.max(0, 1 - rules.holder.sellPenalty * soldFraction);
  }
  return { ...now, balance, clockMs };
}

export interface LevelProgress {
  holderLevel: HolderLevel;
  /** USD still needed for the next holder level's bag (0 at H3). */
  usdToNextHolder: number;
  /** Real time (ms) until the hold clock reaches the next level, at the current speed (0 at H3 or if met). */
  msToNextHolder: number;
  /** Current clock speed (1× to 3×). */
  speed: number;
}

export function holderProgress(w: WalletState, p: PriceContext, now: number, rules: Rules): LevelProgress {
  const holderLevel = computeHolderLevel(w, p, now, rules);
  const speed = clockSpeed(w.balance, p, rules);
  if (holderLevel === 3) return { holderLevel, usdToNextHolder: 0, msToNextHolder: 0, speed };
  const i = holderLevel; // index of the next level's thresholds
  const clockLeft = Math.max(0, rules.holder.clockMs[i]! - holdClockMs(w, now, p, rules));
  return {
    holderLevel,
    usdToNextHolder: Math.max(0, rules.holder.usd[i]! - positionUsd(w.balance, p)),
    msToNextHolder: clockLeft / speed,
    speed,
  };
}
