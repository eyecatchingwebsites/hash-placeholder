/** Miner level M1-M3. */
export type Level = 1 | 2 | 3;
/** Holder level: 0 = below H1, then H1-H3. */
export type HolderLevel = 0 | 1 | 2 | 3;

export interface Rules {
  /**
   * The Token-2022 transfer tax and its split, as fractions of trade value.
   * Dev is fixed. Miners get what reaches the target, up to chestMax. Holders get the rest,
   * which is at least total - dev - chestMax.
   */
  tax: { total: number; dev: number; chestMax: number };
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
    /** Max share of one holder pot a single wallet can take (0..1). */
    walletCap: number;
  };
  miner: {
    /**
     * Hours mined needed for M2 / M3, counted over the last `windowDays`. An hour counts when the
     * wallet had at least one GPU with accepted shares (clock time, not summed per GPU).
     */
    hours: { 2: number; 3: number };
    windowDays: number;
    /** Holder level a wallet needs to unlock M2 / M3. */
    needsHolder: { 2: HolderLevel; 3: HolderLevel };
    /** Chest weight multiplier per miner level. */
    mult: Record<Level, number>;
  };
  /** Chest weight = earningsUsd ** alpha × miner multiplier. 0.5 = square-root GPU balancing. */
  alpha: number;
  /** Max share of one epoch's chest a single wallet can take (0..1). */
  walletCap: number;
  /** Share of estimated mining earnings paid immediately; the rest waits for confirmation. */
  immediateShare: number;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_RULES: Rules = {
  tax: { total: 0.05, dev: 0.005, chestMax: 0.035 },
  minerTargetMult: 5,
  holder: {
    usd: [50, 500, 2500],
    clockMs: [0, 24 * HOUR_MS, 7 * 24 * HOUR_MS],
    speedPerUsd: 2500,
    maxSpeed: 3,
    sellPenalty: 2.5,
    mult: { 1: 1, 2: 2, 3: 4 },
    walletCap: 0.05,
  },
  miner: {
    hours: { 2: 48, 3: 120 },
    windowDays: 14,
    needsHolder: { 2: 1, 3: 2 },
    mult: { 1: 1, 2: 2, 3: 4 },
  },
  alpha: 0.5,
  walletCap: 0.05,
  immediateShare: 0.75,
};

/** Smallest share of the tax that always goes to holders. */
export function holderMinShare(rules: Rules): number {
  return Math.max(0, rules.tax.total - rules.tax.dev - rules.tax.chestMax);
}
