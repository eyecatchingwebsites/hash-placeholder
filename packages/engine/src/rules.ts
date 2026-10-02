export type Level = 1 | 2 | 3;

export interface Rules {
  /** Total trading fee and its split, as fractions of trade value. Burn gets the remainder. */
  fee: { total: number; chest: number; creator: number };
  levels: {
    /** Chest weight multiplier per level. */
    mult: Record<Level, number>;
    /** Position (USD) needed for L2. */
    l2Usd: number;
    /** Position (USD) needed for L3. */
    l3Usd: number;
    /** Wallet age needed for L3, counted from the first time $HASH landed in it. */
    l3AgeMs: number;
  };
  /** Weight = earningsUsd ** alpha × level multiplier. 0.5 = square-root GPU balancing. */
  alpha: number;
  /** Max share of one epoch's chest a single wallet can take (0..1). */
  walletCap: number;
  /** Share of estimated mining earnings paid immediately; the rest waits for confirmation. */
  immediateShare: number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RULES: Rules = {
  fee: { total: 0.05, chest: 0.03, creator: 0.005 },
  levels: {
    mult: { 1: 1, 2: 2, 3: 4 },
    l2Usd: 50,
    l3Usd: 500,
    l3AgeMs: 14 * DAY_MS,
  },
  alpha: 0.5,
  walletCap: 0.05,
  immediateShare: 0.75,
};

export function burnShare(rules: Rules): number {
  return Math.max(0, rules.fee.total - rules.fee.chest - rules.fee.creator);
}
