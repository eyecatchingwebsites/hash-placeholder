// The public tax formula, applied: look at recent trading and mining, and schedule a new rate when
// the formula says so (engine `targetTaxRate`). Token-2022 applies it about 4 days later.
import { DAY_MS, targetTaxRate, type Rules } from "@hashcoin/engine";
import { dayKey, type Ledger } from "./ledger.js";

export interface RateConfig {
  /** Days of trading and mining the formula looks at. */
  lookbackDays: number;
  /** At most one change per this many hours (each one shows on-chain ~4 days ahead). */
  minIntervalHours: number;
}

export interface RateDecision {
  bps: number;
  volumeUsd: number;
  minedUsd: number;
  reason: string;
}

/**
 * The rate the formula wants now, or null to leave it alone: no trading yet, already at (or
 * scheduled to) that rate, or changed too recently.
 */
export function decideRate(l: Ledger, x: { now: number; priceUsd: number; liveBps: number; scheduledBps?: number }, cfg: RateConfig, rules: Rules): RateDecision | null {
  let volumeTokens = 0, minedUsd = 0;
  for (let i = 0; i < cfg.lookbackDays; i++) {
    const d = l.days[dayKey(x.now - i * DAY_MS)];
    if (d) { volumeTokens += d.volumeTokens; minedUsd += d.minedUsd; }
  }
  const volumeUsd = volumeTokens * x.priceUsd;
  if (!(volumeUsd > 0)) return null;
  const bps = Math.round(targetTaxRate({ volumeUsd, minedUsd }, rules) * 10_000);
  if (bps === (x.scheduledBps ?? x.liveBps)) return null;
  const last = l.rateChanges[l.rateChanges.length - 1];
  if (last && x.now - last.at < cfg.minIntervalHours * 3_600_000) return null;
  const pct = (b: number) => `${(b / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  return {
    bps, volumeUsd, minedUsd,
    reason: `${cfg.lookbackDays}d: $${volumeUsd.toFixed(2)} traded, $${minedUsd.toFixed(2)} mined → ${pct(bps)} (was ${pct(x.scheduledBps ?? x.liveBps)})`,
  };
}
