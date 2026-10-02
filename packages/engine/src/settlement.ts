import type { PendingRecord } from "./epoch.js";

export interface SettlementLine {
  address: string;
  /** USD to pay now. Can be 0 if the immediate payment already exceeded the wallet's real share. */
  payUsd: number;
  /** Positive when the platform overpaid (absorbed by the platform, never clawed back). */
  overpaidUsd: number;
}

/**
 * True-up once an epoch's mined coin has confirmed and sold.
 * Each wallet's real earnings = its share of estimated mining × actual sale proceeds.
 * It receives real earnings minus what it was already paid immediately.
 * Orphaned blocks or a price drop mean proceeds < estimate, and the platform eats
 * any overpayment from the immediate share.
 */
export function settle(records: PendingRecord[], actualProceedsUsd: number): {
  lines: SettlementLine[];
  totalPayUsd: number;
  totalOverpaidUsd: number;
  ratio: number;
} {
  const estimated = records.reduce((a, r) => a + r.miningUsd, 0);
  const ratio = estimated > 0 ? Math.max(0, actualProceedsUsd) / estimated : 0;
  const lines = records.map((r) => {
    const real = r.miningUsd * ratio;
    const owed = real - r.immediateUsd;
    return { address: r.address, payUsd: Math.max(0, owed), overpaidUsd: Math.max(0, -owed) };
  });
  return {
    lines,
    totalPayUsd: lines.reduce((a, l) => a + l.payUsd, 0),
    totalOverpaidUsd: lines.reduce((a, l) => a + l.overpaidUsd, 0),
    ratio,
  };
}
