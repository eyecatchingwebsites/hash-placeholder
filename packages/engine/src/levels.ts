import type { Level, Rules } from "./rules.js";

/** What the platform tracks per payout wallet. Token amounts are in base units. */
export interface WalletState {
  address: string;
  /** Current $HASH balance (base units), read from chain. */
  balance: bigint;
  /** First time $HASH landed in the wallet (ms epoch). Null if it never held any. */
  firstHashAt: number | null;
  /** True once any $HASH has left the wallet (sell, transfer, LP or CEX deposit). Permanent. */
  everSold: boolean;
}

export interface PriceContext {
  /** USD per whole token, ideally a ~1h time-weighted average. */
  priceUsd: number;
  decimals: number;
}

export function positionUsd(balance: bigint, p: PriceContext): number {
  return (Number(balance) / 10 ** p.decimals) * p.priceUsd;
}

/**
 * Level rules:
 * - L3: position >= l3Usd, wallet age >= l3AgeMs since first $HASH, never sold.
 *   Dropping below l3Usd falls to L2; climbing back restores L3 with no new wait.
 * - L2: position >= l2Usd.
 * - L1: everyone else who mines.
 */
export function computeLevel(w: WalletState, p: PriceContext, now: number, rules: Rules): Level {
  const usd = positionUsd(w.balance, p);
  const aged = w.firstHashAt !== null && now - w.firstHashAt >= rules.levels.l3AgeMs;
  if (!w.everSold && aged && usd >= rules.levels.l3Usd) return 3;
  if (usd >= rules.levels.l2Usd) return 2;
  return 1;
}

/** Apply an observed on-chain balance change to the wallet state. */
export function applyBalanceChange(w: WalletState, delta: bigint, at: number): WalletState {
  const balance = w.balance + delta;
  return {
    ...w,
    balance: balance < 0n ? 0n : balance,
    firstHashAt: w.firstHashAt ?? (delta > 0n ? at : null),
    // Any outflow counts as selling, including wallet-to-wallet transfers.
    everSold: w.everSold || delta < 0n,
  };
}

export interface LevelProgress {
  level: Level;
  /** USD still needed for the next level (0 if already met). */
  usdToNext: number;
  /** Ms of wallet age still needed for L3 (0 if met). Null if L3 is permanently closed. */
  msToL3: number | null;
}

export function levelProgress(w: WalletState, p: PriceContext, now: number, rules: Rules): LevelProgress {
  const level = computeLevel(w, p, now, rules);
  const usd = positionUsd(w.balance, p);
  const target = level === 1 ? rules.levels.l2Usd : rules.levels.l3Usd;
  const age = w.firstHashAt === null ? 0 : now - w.firstHashAt;
  return {
    level,
    usdToNext: level === 3 ? 0 : Math.max(0, target - usd),
    msToL3: w.everSold ? null : Math.max(0, rules.levels.l3AgeMs - age),
  };
}
