import { readFileSync } from "node:fs";
import { gpuKey, type RevenueQuote } from "@hashcoin/switcher";

interface HashrateNoRow { name: string; topRevCoin: string; topRev24: number; coin: string; rev24: number }

/**
 * Load the hashrate.no snapshot as catalog quotes (best-revenue coin and best-profit coin per card).
 * A live feed should replace this before launch; the rig's own benchmarks override it either way.
 */
export function loadHashrateNoQuotes(path: string): RevenueQuote[] {
  const rows = JSON.parse(readFileSync(path, "utf8")) as HashrateNoRow[];
  const out: RevenueQuote[] = [];
  for (const r of rows) {
    const gpu = gpuKey(r.name);
    out.push({ gpu, coin: r.topRevCoin, usdPerDay: r.topRev24 });
    if (r.coin !== r.topRevCoin) out.push({ gpu, coin: r.coin, usdPerDay: r.rev24 });
  }
  return out;
}
