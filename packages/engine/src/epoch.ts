import { computeLevel, type PriceContext, type WalletState } from "./levels.js";
import type { Level, Rules } from "./rules.js";
import { chestShares } from "./weights.js";

export interface EpochInput {
  epochId: string;
  now: number;
  /** Estimated mining earnings per wallet this epoch (USD), from accepted shares. */
  earnings: Map<string, number>;
  wallets: Map<string, WalletState>;
  price: PriceContext;
  /** Chest fees collected this epoch (USD), plus anything carried from earlier epochs. */
  chestUsd: number;
  /** USD value the float can pay out right now. Immediate payouts are scaled down to fit. */
  floatAvailableUsd: number;
  rules: Rules;
}

export interface PayoutLine {
  address: string;
  level: Level;
  miningUsd: number;
  /** Mining paid now, from the float. */
  immediateUsd: number;
  /** Mining held until the mined coin confirms and sells. */
  pendingUsd: number;
  chestShare: number;
  chestUsd: number;
  /** USD paid in this epoch's batch (immediate mining + chest). */
  payNowUsd: number;
}

export interface PendingRecord {
  epochId: string;
  address: string;
  /** Estimated USD owed once the epoch's mined coin settles. */
  estimatedUsd: number;
  /** Full estimated mining USD for this wallet this epoch (used for true-up). */
  miningUsd: number;
  immediateUsd: number;
}

export interface EpochResult {
  epochId: string;
  lines: PayoutLine[];
  pending: PendingRecord[];
  /** Chest not distributed (wallet caps, no eligible miners); add it to the next epoch. */
  carryUsd: number;
  totals: { miningUsd: number; immediateUsd: number; pendingUsd: number; chestUsd: number; payNowUsd: number };
}

const EMPTY_WALLET = (address: string): WalletState => ({ address, balance: 0n, firstHashAt: null, everSold: false });

export function runEpoch(input: EpochInput): EpochResult {
  const { rules, price, now } = input;
  const entries = [...input.earnings].filter(([, usd]) => usd > 0).map(([address, earningsUsd]) => {
    const w = input.wallets.get(address) ?? EMPTY_WALLET(address);
    return { address, earningsUsd, level: computeLevel(w, price, now, rules) };
  });

  const shares = chestShares(entries, rules);
  const miningTotal = entries.reduce((a, e) => a + e.earningsUsd, 0);
  const wantImmediate = miningTotal * rules.immediateShare;
  // Never promise more than the float holds: scale the immediate share down if needed.
  const scale = wantImmediate > 0 ? Math.min(1, Math.max(0, input.floatAvailableUsd) / wantImmediate) : 1;
  const immediateShare = rules.immediateShare * scale;

  const lines: PayoutLine[] = [];
  const pending: PendingRecord[] = [];
  let chestPaid = 0;
  for (const e of entries) {
    const share = shares.get(e.address) ?? 0;
    const chestUsd = input.chestUsd * share;
    const immediateUsd = e.earningsUsd * immediateShare;
    const pendingUsd = e.earningsUsd - immediateUsd;
    chestPaid += chestUsd;
    lines.push({
      address: e.address, level: e.level, miningUsd: e.earningsUsd, immediateUsd, pendingUsd,
      chestShare: share, chestUsd, payNowUsd: immediateUsd + chestUsd,
    });
    if (pendingUsd > 0) {
      pending.push({ epochId: input.epochId, address: e.address, estimatedUsd: pendingUsd, miningUsd: e.earningsUsd, immediateUsd });
    }
  }
  lines.sort((a, b) => b.payNowUsd - a.payNowUsd);

  const sum = (k: keyof PayoutLine) => lines.reduce((a, l) => a + (l[k] as number), 0);
  return {
    epochId: input.epochId,
    lines,
    pending,
    carryUsd: Math.max(0, input.chestUsd - chestPaid),
    totals: {
      miningUsd: miningTotal, immediateUsd: sum("immediateUsd"), pendingUsd: sum("pendingUsd"),
      chestUsd: chestPaid, payNowUsd: sum("payNowUsd"),
    },
  };
}
