// SOL/USD for valuing mining and the float. Jupiter's price API, CoinGecko as a fallback, both
// checked against sane bounds; the last good price is reused for up to 30 minutes.
const SOL = "So11111111111111111111111111111111111111112";

export interface SolPriceConfig { source: "live" | "fixed"; fixed?: number; min: number; max: number }

let cache: { at: number; usd: number; from: string } | null = null;

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

export async function solUsd(cfg: SolPriceConfig, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<{ usd: number; from: string }> {
  if (cfg.source === "fixed") {
    if (!(cfg.fixed! > 0)) throw new Error("solUsd.fixed must be set");
    return { usd: cfg.fixed!, from: "fixed" };
  }
  const ok = (x: number) => Number.isFinite(x) && x >= cfg.min && x <= cfg.max;
  const errors: string[] = [];
  const sources: [string, () => Promise<number>][] = [
    ["jupiter", async () => ((await getJson(`https://lite-api.jup.ag/price/v3?ids=${SOL}`, fetchFn)) as Record<string, { usdPrice?: number }>)[SOL]?.usdPrice ?? NaN],
    ["coingecko", async () => ((await getJson("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", fetchFn)) as { solana?: { usd?: number } }).solana?.usd ?? NaN],
  ];
  for (const [name, get] of sources) {
    try {
      const usd = Number(await get());
      if (ok(usd)) { cache = { at: now, usd, from: name }; return { usd, from: name }; }
      errors.push(`${name}: ${usd} outside ${cfg.min}-${cfg.max}`);
    } catch (e) { errors.push(`${name}: ${(e as Error).message}`); }
  }
  if (cache && now - cache.at < 30 * 60_000) return { usd: cache.usd, from: `${cache.from} (cached)` };
  throw new Error(`no SOL price: ${errors.join("; ")}`);
}
