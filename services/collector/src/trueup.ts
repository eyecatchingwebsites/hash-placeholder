// Truing the collector up to the pool. The collector values mining from hashrate (an estimate:
// pool averages lag, share luck, the 15-minute cap per run); the pool's own ledger says what it
// actually credited. Each time the pool's running total moves, the estimate since the last move is
// checked against it, and the ratio over the last day scales what wallets are credited.

export interface TrueUpState {
  /** The pool's running total (balance + all payouts, in coins) at the last reading. */
  earned?: number;
  /** Estimated coins (all workers under the address) since the pool's total last moved. */
  estimatedSince: number;
  /** Each time the pool's total moved: what it credited vs what we estimated for that stretch. */
  checkpoints: { at: number; actual: number; estimated: number }[];
}

export interface TrueUpConfig {
  /** How far back the ratio looks. */
  windowMs: number;
  /** Below this many estimated coins in the window, there isn't enough to judge: ratio 1. */
  minEstimated: number;
  /** The ratio is held inside these bounds (outside them is flagged, not trusted). */
  min: number;
  max: number;
}

export const DEFAULT_TRUE_UP: TrueUpConfig = { windowMs: 24 * 3_600_000, minEstimated: 0.05, min: 0.5, max: 1.5 };

export interface TrueUpResult {
  state: TrueUpState;
  /** Multiply estimated mining by this. 1 until there's enough data. */
  ratio: number;
  /** The unclamped ratio, or null without enough data. */
  raw: number | null;
  window: { actual: number; estimated: number };
  /** Something worth an alert: the pool's total went backwards, or the raw ratio is out of bounds. */
  flag?: string;
}

/**
 * Add one collector run. `earned` is the pool's running total now (null if the pool couldn't be
 * read: the estimate keeps accumulating and the last ratio stands), `estimated` the coins this run
 * estimated for every worker under the address, registered or not.
 */
export function trueUp(prev: TrueUpState | undefined, now: number, earned: number | null, estimated: number, cfg: TrueUpConfig = DEFAULT_TRUE_UP): TrueUpResult {
  const s: TrueUpState = { earned: prev?.earned, estimatedSince: (prev?.estimatedSince ?? 0) + Math.max(0, estimated), checkpoints: [...(prev?.checkpoints ?? [])] };
  let flag: string | undefined;
  if (earned !== null) {
    if (s.earned === undefined) {
      // First reading: a baseline. What was mined before it isn't ours to check.
      s.earned = earned;
      s.estimatedSince = 0;
    } else if (earned < s.earned - 1e-9) {
      flag = `pool total went down (${s.earned} → ${earned}): payout history incomplete? Re-baselined.`;
      s.earned = earned;
      s.estimatedSince = 0;
    } else if (earned > s.earned + 1e-12) {
      s.checkpoints.push({ at: now, actual: earned - s.earned, estimated: s.estimatedSince });
      s.earned = earned;
      s.estimatedSince = 0;
    }
  }
  s.checkpoints = s.checkpoints.filter((c) => c.at > now - cfg.windowMs);
  const window = s.checkpoints.reduce((a, c) => ({ actual: a.actual + c.actual, estimated: a.estimated + c.estimated }), { actual: 0, estimated: 0 });
  const raw = window.estimated >= cfg.minEstimated ? window.actual / window.estimated : null;
  let ratio = 1;
  if (raw !== null) {
    ratio = Math.min(cfg.max, Math.max(cfg.min, raw));
    if (ratio !== raw) flag = `pool credited ${raw.toFixed(2)}x our estimate over the last ${Math.round(cfg.windowMs / 3_600_000)} h; using ${ratio}`;
  }
  return { state: s, ratio, raw, window, ...(flag ? { flag } : {}) };
}
