export interface Transfer {
  address: string;
  /** Token base units. */
  amount: bigint;
}

/**
 * Split tokens actually bought for a payout across wallets in proportion to the
 * USD each is owed. Uses integer base units; rounding dust goes to the largest
 * recipients so the batch sums exactly to `tokens`. Transfers below `minAmount`
 * are dropped and their USD is returned so the caller can roll it into the next batch.
 */
export function splitTokens(
  owedUsd: { address: string; usd: number }[],
  tokens: bigint,
  minAmount = 1n,
): { transfers: Transfer[]; deferred: { address: string; usd: number }[] } {
  const totalUsd = owedUsd.reduce((a, o) => a + Math.max(0, o.usd), 0);
  if (totalUsd <= 0 || tokens <= 0n) return { transfers: [], deferred: owedUsd.filter((o) => o.usd > 0) };

  const SCALE = 1_000_000_000n;
  const raw = owedUsd
    .filter((o) => o.usd > 0)
    .map((o) => {
      const frac = BigInt(Math.floor((o.usd / totalUsd) * Number(SCALE)));
      return { ...o, amount: (tokens * frac) / SCALE };
    });
  let dust = tokens - raw.reduce((a, r) => a + r.amount, 0n);
  raw.sort((a, b) => b.usd - a.usd);
  for (let i = 0; dust > 0n && raw.length > 0; i = (i + 1) % raw.length) {
    raw[i]!.amount += 1n;
    dust -= 1n;
  }

  const transfers: Transfer[] = [];
  const deferred: { address: string; usd: number }[] = [];
  for (const r of raw) {
    if (r.amount >= minAmount) transfers.push({ address: r.address, amount: r.amount });
    else deferred.push({ address: r.address, usd: r.usd });
  }
  return { transfers, deferred };
}
