export type Vendor = "nvidia" | "amd" | "intel";

export interface PoolEndpoint {
  /** stratum URL, e.g. stratum+tcp://pool.example.com:3333 */
  url: string;
  region: string;
}

export interface CoinInfo {
  /** Ticker, e.g. "PRL". */
  id: string;
  algo: string;
  enabled: boolean;
  /** Which GPU vendors have a usable miner for this algo. */
  vendors: Vendor[];
  /** Estimated daily sell capacity (USD) before slippage gets painful. */
  liquidityUsdPerDay: number;
  /** Typical hours until mined coins are confirmed and sellable. */
  confirmHours: number;
  pools: PoolEndpoint[];
  /** Miner id from the miner manifest to use for this coin, per vendor. */
  miner: Partial<Record<Vendor, string>>;
}

/** Revenue estimate for one GPU model on one coin (USD per day, before power). */
export interface RevenueQuote {
  gpu: string;
  coin: string;
  usdPerDay: number;
}

/** A rig's own benchmark: measured revenue per day for a coin on a specific card. */
export interface Benchmark {
  coin: string;
  usdPerDay: number;
}

export interface GpuReport {
  index: number;
  /** Model name as reported by the driver, e.g. "NVIDIA GeForce RTX 4070". */
  name: string;
  vendor: Vendor;
  memoryMb?: number;
  benchmarks?: Benchmark[];
}

export interface ScoreInputs {
  /** Total USD/day the whole platform is already selling of each coin. */
  platformSellUsdPerDay: Record<string, number>;
  /** Fraction of revenue lost per hour of confirmation delay (price risk). */
  delayRiskPerHour: number;
  /** Slippage = slippageK × (platform sell volume ÷ liquidity), capped. */
  slippageK: number;
  slippageCap: number;
}

export interface SwitchPolicy {
  /** New coin must beat the current one by this fraction... */
  minGain: number;
  /** ...continuously for this long before switching. */
  sustainMs: number;
  /** Minimum time on a coin after a switch. */
  minDwellMs: number;
}

export interface Assignment {
  v: 1;
  rigId: string;
  wallet: string;
  gpuIndex: number;
  gpu: string;
  coin: string;
  algo: string;
  minerId: string;
  pool: { url: string; user: string; pass: string };
  /** Expected net USD/day used for the decision (for display). */
  expectedUsdPerDay: number;
  reason: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SignedEnvelope {
  /** Key id, so the app can rotate keys. */
  kid: string;
  /** Canonical JSON payload, exactly as signed. */
  payload: string;
  /** Base64 Ed25519 signature over the UTF-8 bytes of `payload`. */
  sig: string;
}
