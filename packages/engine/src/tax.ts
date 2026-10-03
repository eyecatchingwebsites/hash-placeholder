import type { Rules } from "./rules.js";

export interface TaxSplitInput {
  /** Tax collected this epoch (the full 5%), in USD at the payout price. */
  taxUsd: number;
  /** What miners' GPUs mined this epoch (USD). */
  minedUsd: number;
  /** Chest left over from earlier epochs (wallet caps etc.); counts toward the target. */
  chestCarryUsd?: number;
}

export interface TaxSplit {
  devUsd: number;
  /** New money for the miner chest this epoch (add the carry on top when paying out). */
  chestUsd: number;
  holderUsd: number;
  /** Chest share of trade value (0..chestMax), for display. */
  chestRate: number;
  /** True if miners reach the target multiple this epoch. */
  targetMet: boolean;
}

/**
 * Split one epoch's tax. Dev gets a fixed share. The chest gets exactly what lifts miners'
 * total pay to `minerTargetMult` × what they mined, capped at `chestMax`. Holders get the rest,
 * so they always receive at least total - dev - chestMax.
 */
export function splitTax(x: TaxSplitInput, rules: Rules): TaxSplit {
  const { total, dev, chestMax } = rules.tax;
  const taxUsd = Math.max(0, x.taxUsd);
  if (taxUsd === 0) return { devUsd: 0, chestUsd: 0, holderUsd: 0, chestRate: 0, targetMet: false };
  const devUsd = (taxUsd * dev) / total;
  const chestCap = (taxUsd * chestMax) / total;
  const need = Math.max(0, (rules.minerTargetMult - 1) * Math.max(0, x.minedUsd) - (x.chestCarryUsd ?? 0));
  const chestUsd = Math.min(chestCap, need);
  return {
    devUsd,
    chestUsd,
    holderUsd: taxUsd - devUsd - chestUsd,
    chestRate: (chestUsd / taxUsd) * total,
    targetMet: need <= chestCap,
  };
}
