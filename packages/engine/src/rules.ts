/** Miner level M1-M3. */
export type Level = 1 | 2 | 3;
/** Holder level: 0 = below H1, then H1-H3. */
export type HolderLevel = 0 | 1 | 2 | 3;

export interface Rules {
  /**
   * The Token-2022 transfer tax: a rate between `minRate` and `maxRate` (set by `targetTaxRate` in
   * `step`s), split as shares of the tax: dev 5–10% (falls as the rate rises), miners 45–75% (what
   * reaches the 5× target), holders the rest (at least `holderShareMin`).
   */
  tax: {
    minRate: number;
    maxRate: number;
    step: number;
    devShare: { atMinRate: number; atMaxRate: number };
    minerShare: { min: number; max: number };
    holderShareMin: number;
  };
  /** Miners' total pay target as a multiple of what their GPUs mined (5 = mining + 4× from the chest). */
  minerTargetMult: number;
  holder: {
    /** Bag (USD) needed for H1 / H2 / H3. */
    usd: [number, number, number];
    /** Hold clock needed for H1 / H2 / H3 (ms of clock time, which can run faster than real time). */
    clockMs: [number, number, number];
    /**
     * Clock speed = bag USD ÷ `speedPerUsd`, between 1× and `maxSpeed`×. A bigger bag ages faster;
     * buying more speeds the clock up from then on, never with an instant jump.
     */
    speedPerUsd: number;
    maxSpeed: number;
    /** Selling a fraction s of the bag takes `sellPenalty` × s of the clock (2.5: sell 20%, lose 50%; 40%+ resets). */
    sellPenalty: number;
    /** Holder-pot weight multiplier per holder level. */
    mult: Record<1 | 2 | 3, number>;
  };
  miner: {
    /**
     * Hours mined needed for M2 / M3, counted over the last `windowDays`. An hour counts when the
     * wallet had at least one GPU with accepted shares (clock time, not summed per GPU).
     */
    hours: { 2: number; 3: number };
    windowDays: number;
    /**
     * An hour counts in full when the GPU earns at least this share of its expected rate (catalog
     * revenue for its model on the assigned coin); below that it counts in proportion (0.8: at 40%,
     * an hour counts as half an hour).
     */
    fullCreditAt: number;
    /** Holder level a wallet needs to unlock M2 / M3. */
    needsHolder: { 2: HolderLevel; 3: HolderLevel };
    /** Chest weight multiplier per miner level. */
    mult: Record<Level, number>;
  };
  /** Chest weight = earningsUsd ** alpha × miner multiplier. 0.5 = square-root GPU balancing. */
  alpha: number;
  /** Share of estimated mining earnings paid immediately; the rest waits for confirmation. */
  immediateShare: number;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_RULES: Rules = {
  tax: {
    minRate: 0.02,
    maxRate: 0.05,
    step: 0.0025,
    devShare: { atMinRate: 0.10, atMaxRate: 0.05 },
    minerShare: { min: 0.45, max: 0.75 },
    holderShareMin: 0.20,
  },
  minerTargetMult: 5,
  holder: {
    usd: [50, 500, 2500],
    clockMs: [0, 24 * HOUR_MS, 7 * 24 * HOUR_MS],
    speedPerUsd: 2500,
    maxSpeed: 3,
    sellPenalty: 2.5,
    mult: { 1: 1, 2: 2, 3: 4 },
  },
  miner: {
    hours: { 2: 48, 3: 120 },
    windowDays: 14,
    fullCreditAt: 0.8,
    needsHolder: { 2: 1, 3: 2 },
    mult: { 1: 1, 2: 2, 3: 4 },
  },
  alpha: 0.5,
  immediateShare: 0.75,
};
