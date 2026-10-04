import type { HolderLevel, Level, Rules } from "./rules.js";

export interface WeightInput {
  address: string;
  /** Estimated mining earnings this epoch in USD (from accepted shares). */
  earningsUsd: number;
  /** Miner level M1-M3. */
  level: Level;
}

export function weightOf(x: WeightInput, rules: Rules): number {
  if (x.earningsUsd <= 0) return 0;
  return Math.pow(x.earningsUsd, rules.alpha) * rules.miner.mult[x.level];
}

/** Each address's share of the pot: its weight over the total. No per-wallet cap (user, Oct 4). */
export function proportionalShares(weights: Map<string, number>): Map<string, number> {
  const total = [...weights.values()].reduce((a, w) => a + (w > 0 ? w : 0), 0);
  const shares = new Map<string, number>();
  if (total <= 0) return shares;
  for (const [addr, w] of weights) if (w > 0) shares.set(addr, w / total);
  return shares;
}

/** Miner chest shares: √(earnings) × miner level. */
export function chestShares(inputs: WeightInput[], rules: Rules): Map<string, number> {
  const weights = new Map<string, number>();
  for (const x of inputs) {
    const w = weightOf(x, rules);
    if (w > 0) weights.set(x.address, (weights.get(x.address) ?? 0) + w);
  }
  return proportionalShares(weights);
}

export interface HolderWeightInput {
  address: string;
  /** Bag value in USD. */
  balanceUsd: number;
  level: HolderLevel;
}

/**
 * Holder pot shares: bag × holder level. Linear in the bag (not √),
 * so splitting one bag across many wallets gains nothing. Wallets below H1 get nothing.
 */
export function holderShares(inputs: HolderWeightInput[], rules: Rules): Map<string, number> {
  const weights = new Map<string, number>();
  for (const x of inputs) {
    if (x.level === 0 || x.balanceUsd <= 0) continue;
    const w = x.balanceUsd * rules.holder.mult[x.level];
    weights.set(x.address, (weights.get(x.address) ?? 0) + w);
  }
  return proportionalShares(weights);
}
