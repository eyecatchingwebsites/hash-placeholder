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

/**
 * Shares per address from weights, summing to <= 1. Shares above `cap` are clipped and
 * the excess is redistributed to uncapped addresses by weight (water-filling). If every
 * address is capped, the leftover stays undistributed.
 */
export function cappedShares(weights: Map<string, number>, cap: number): Map<string, number> {
  const shares = new Map<string, number>();
  const limit = cap > 0 ? cap : 1;
  const open = new Map([...weights].filter(([, w]) => w > 0));
  let remaining = 1;
  while (open.size > 0) {
    const total = [...open.values()].reduce((a, b) => a + b, 0);
    const capped: string[] = [];
    for (const [addr, w] of open) {
      if ((remaining * w) / total > limit) capped.push(addr);
    }
    if (capped.length === 0) {
      for (const [addr, w] of open) shares.set(addr, (remaining * w) / total);
      break;
    }
    for (const addr of capped) {
      shares.set(addr, limit);
      open.delete(addr);
      remaining -= limit;
    }
    if (remaining <= 1e-12) break;
  }
  return shares;
}

/** Miner chest shares: √(earnings) × miner level, capped per wallet. */
export function chestShares(inputs: WeightInput[], rules: Rules): Map<string, number> {
  const weights = new Map<string, number>();
  for (const x of inputs) {
    const w = weightOf(x, rules);
    if (w > 0) weights.set(x.address, (weights.get(x.address) ?? 0) + w);
  }
  return cappedShares(weights, rules.walletCap);
}

export interface HolderWeightInput {
  address: string;
  /** Bag value in USD. */
  balanceUsd: number;
  level: HolderLevel;
}

/**
 * Holder pot shares: bag × holder level, capped per wallet. Linear in the bag (not √),
 * so splitting one bag across many wallets gains nothing. Wallets below H1 get nothing.
 */
export function holderShares(inputs: HolderWeightInput[], rules: Rules): Map<string, number> {
  const weights = new Map<string, number>();
  for (const x of inputs) {
    if (x.level === 0 || x.balanceUsd <= 0) continue;
    const w = x.balanceUsd * rules.holder.mult[x.level];
    weights.set(x.address, (weights.get(x.address) ?? 0) + w);
  }
  return cappedShares(weights, rules.holder.walletCap);
}
