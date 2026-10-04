import { gpuKey } from "./gpus.js";
import type { CoinInfo, GpuReport, RevenueQuote, ScoreInputs } from "./types.js";

export interface CoinScore {
  coin: string;
  grossUsdPerDay: number;
  netUsdPerDay: number;
  source: "benchmark" | "catalog";
}

/**
 * Score every enabled coin this GPU can mine.
 * Gross revenue comes from the rig's own benchmark when present, else the catalog.
 * Net = gross × (1 − slippage − delay risk), so thin or slow-to-confirm coins rank lower.
 */
export function scoreCoins(gpu: GpuReport, coins: CoinInfo[], quotes: RevenueQuote[], s: ScoreInputs): CoinScore[] {
  const key = gpuKey(gpu.name);
  const out: CoinScore[] = [];
  for (const c of coins) {
    if (!c.enabled || !c.payoutAddress || !c.vendors.includes(gpu.vendor) || !c.miner[gpu.vendor] || c.pools.length === 0) continue;
    const bench = gpu.benchmarks?.find((b) => b.coin === c.id);
    const quote = quotes.find((q) => q.coin === c.id && q.gpu === key);
    const gross = bench?.usdPerDay ?? quote?.usdPerDay;
    if (gross === undefined || gross <= 0) continue;
    const sell = s.platformSellUsdPerDay[c.id] ?? 0;
    const slippage = c.liquidityUsdPerDay > 0 ? Math.min(s.slippageCap, (s.slippageK * sell) / c.liquidityUsdPerDay) : s.slippageCap;
    const delay = s.delayRiskPerHour * c.confirmHours;
    out.push({
      coin: c.id,
      grossUsdPerDay: gross,
      netUsdPerDay: gross * Math.max(0, 1 - slippage - delay),
      source: bench ? "benchmark" : "catalog",
    });
  }
  return out.sort((a, b) => b.netUsdPerDay - a.netUsdPerDay);
}
