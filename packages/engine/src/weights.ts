import type { Level, Rules } from "./rules.js";

export interface WeightInput {
  address: string;
  /** Estimated mining earnings this epoch in USD (from accepted shares). */
  earningsUsd: number;
  level: Level;
}

export function weightOf(x: WeightInput, rules: Rules): number {
  if (x.earningsUsd <= 0) return 0;
  return Math.pow(x.earningsUsd, rules.alpha) * rules.levels.mult[x.level];
}

/**
 * Chest shares per address, summing to <= 1. Shares above the wallet cap are
 * clipped and the excess is redistributed to uncapped wallets by weight
 * (water-filling). If every wallet is capped, the leftover stays undistributed.
 */
export function chestShares(inputs: WeightInput[], rules: Rules): Map<string, number> {
  const weights = new Map<string, number>();
  for (const x of inputs) {
    const w = weightOf(x, rules);
    if (w > 0) weights.set(x.address, (weights.get(x.address) ?? 0) + w);
  }
  const shares = new Map<string, number>();
  const cap = rules.walletCap > 0 ? rules.walletCap : 1;
  let open = new Map(weights);
  let remaining = 1;
  while (open.size > 0) {
    const total = [...open.values()].reduce((a, b) => a + b, 0);
    const capped: string[] = [];
    for (const [addr, w] of open) {
      if ((remaining * w) / total > cap) capped.push(addr);
    }
    if (capped.length === 0) {
      for (const [addr, w] of open) shares.set(addr, (remaining * w) / total);
      break;
    }
    for (const addr of capped) {
      shares.set(addr, cap);
      open.delete(addr);
      remaining -= cap;
    }
    if (remaining <= 1e-12) break;
  }
  return shares;
}
