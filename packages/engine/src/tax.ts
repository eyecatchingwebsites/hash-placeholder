import type { Rules } from "./rules.js";

// The tax and its split (user, Oct 4):
// - The rate moves between 2% and 5%: the lowest rate at which miners can reach their 5× target
//   AND holders still get at least 1% of trading volume (user, Oct 4: option 2). Quiet trading →
//   5%; only heavy trading lowers it (to 2.25% at the lowest: at 2% holders can't reach 1%).
//   Token-2022 applies a change ~2 epochs (~4 days) after it's set, so it's computed from
//   multi-day averages (`targetTaxRate`).
// - Shares of the tax: dev 5–10% (falls as the rate rises, so dev's cut of volume stays about
//   0.2–0.25% and raising the tax doesn't pay the dev more), miners 45–75% (what reaches 5×),
//   holders 20–50% (the rest).

/** Dev's share of the tax at a given rate: 10% at the minimum rate, 5% at the maximum, linear between. */
export function devShareAt(rate: number, rules: Rules): number {
  const { minRate, maxRate, devShare } = rules.tax;
  const t = maxRate > minRate ? Math.min(1, Math.max(0, (rate - minRate) / (maxRate - minRate))) : 0;
  return devShare.atMinRate + (devShare.atMaxRate - devShare.atMinRate) * t;
}

/** Most of the tax miners can take at this rate: 75%, but never so much that holders get under 20%. */
export function minerMaxShareAt(rate: number, rules: Rules): number {
  return Math.min(rules.tax.minerShare.max, 1 - devShareAt(rate, rules) - rules.tax.holderShareMin);
}

export interface TaxSplitInput {
  /** Tax collected this epoch, in USD at the payout price. */
  taxUsd: number;
  /** The tax rate the token charged this epoch (0.02–0.05). */
  rate: number;
  /** What miners' GPUs mined this epoch (USD). */
  minedUsd: number;
  /** Chest left over from earlier epochs (no eligible miners); counts toward the target. */
  chestCarryUsd?: number;
}

export interface TaxSplit {
  devUsd: number;
  /** New money for the miner chest this epoch (add the carry on top when paying out). */
  chestUsd: number;
  holderUsd: number;
  /** Shares of the tax (sum to 1). */
  shares: { dev: number; miners: number; holders: number };
  /** True if the chest reaches miners' 5× target this epoch. */
  targetMet: boolean;
}

/**
 * Split one epoch's tax. Dev's share depends on the rate. Miners get what lifts their total pay to
 * `minerTargetMult` × what they mined, kept between 45% and their max share. Holders get the rest.
 */
export function splitTax(x: TaxSplitInput, rules: Rules): TaxSplit {
  const taxUsd = Math.max(0, x.taxUsd);
  const dev = devShareAt(x.rate, rules);
  const minerMax = minerMaxShareAt(x.rate, rules);
  if (taxUsd === 0) {
    return { devUsd: 0, chestUsd: 0, holderUsd: 0, shares: { dev, miners: rules.tax.minerShare.min, holders: 1 - dev - rules.tax.minerShare.min }, targetMet: false };
  }
  const need = Math.max(0, (rules.minerTargetMult - 1) * Math.max(0, x.minedUsd) - (x.chestCarryUsd ?? 0));
  const miners = Math.min(minerMax, Math.max(rules.tax.minerShare.min, need / taxUsd));
  const holders = 1 - dev - miners;
  return {
    devUsd: taxUsd * dev,
    chestUsd: taxUsd * miners,
    holderUsd: taxUsd * holders,
    shares: { dev, miners, holders },
    targetMet: need <= minerMax * taxUsd,
  };
}

/**
 * The tax rate to set next: the lowest rate (in `step`s from 2% to 5%) at which miners reach their
 * 5× target and holders still get `holderMinOfVolume` of trading volume, given recent daily volume
 * and mining (use multi-day averages: a change lands ~4 days after it's set). If no lower rate does
 * both, the maximum.
 */
export function targetTaxRate(x: { volumeUsd: number; minedUsd: number }, rules: Rules): number {
  const { minRate, maxRate, step, holderMinOfVolume } = rules.tax;
  const volumeUsd = Math.max(0, x.volumeUsd);
  if (volumeUsd === 0) return maxRate;
  const steps = Math.round((maxRate - minRate) / step);
  for (let i = 0; i <= steps; i++) {
    const rate = Number((minRate + i * step).toFixed(6));
    const s = splitTax({ taxUsd: rate * volumeUsd, rate, minedUsd: x.minedUsd }, rules);
    if (s.targetMet && s.holderUsd >= holderMinOfVolume * volumeUsd - 1e-9) return rate;
  }
  return maxRate;
}
