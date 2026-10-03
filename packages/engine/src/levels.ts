import type { HolderLevel, Level, Rules } from "./rules.js";

/** What the platform tracks per wallet. Token amounts are in base units. */
export interface WalletState {
  address: string;
  /** Current $HASH balance (base units), read from chain. */
  balance: bigint;
  /**
   * Start of the hold clock (ms epoch); the clock reads `now - clockStartAt`.
   * Starts when $HASH first lands. Selling a fraction f of the bag shrinks the clock by f.
   * Buying never moves it. Null while the wallet holds nothing.
   */
  clockStartAt: number | null;
}

export interface PriceContext {
  /** USD per whole token, ideally a ~1h time-weighted average. */
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

/**
 * Apply an observed on-chain balance change to the wallet state.
 * Any outflow counts as selling, including wallet-to-wallet transfers, LP and exchange deposits.
 */
export function applyBalanceChange(w: WalletState, delta: bigint, at: number): WalletState {
  const before = w.balance;
  const balance = before + delta < 0n ? 0n : before + delta;
  let clockStartAt = w.clockStartAt;
  if (balance === 0n) {
    clockStartAt = null;
  } else if (delta > 0n && clockStartAt === null) {
    clockStartAt = at;
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
