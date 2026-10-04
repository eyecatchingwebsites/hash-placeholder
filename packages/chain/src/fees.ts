/** The Token-2022 transfer fee on one transfer: ceil(amount × bps ÷ 10,000), capped at `maxFee`. */
export function transferFee(amount: bigint, feeBps: number, maxFee: bigint): bigint {
  if (amount <= 0n || feeBps <= 0) return 0n;
  const fee = (amount * BigInt(feeBps) + 9_999n) / 10_000n;
  return fee > maxFee ? maxFee : fee;
}

/**
 * What to send so the recipient nets `net` after the fee. Our own payouts are taxed too
 * (Token-2022 can't exempt a wallet), so every payout is grossed up; the extra 5% comes back
 * to the treasury when the withheld fees are harvested.
 */
export function grossUp(net: bigint, feeBps: number, maxFee: bigint): bigint {
  if (net <= 0n) return 0n;
  if (feeBps >= 10_000) throw new Error("fee must be below 100%");
  let amount = (net * 10_000n + BigInt(10_000 - feeBps) - 1n) / BigInt(10_000 - feeBps);
  if (amount - transferFee(amount, feeBps, maxFee) < net) amount += 1n;
  // Once the fee hits its cap, net + maxFee is enough.
  return amount - net > maxFee ? net + maxFee : amount;
}

/** Split a list into chunks of `size` (one chunk per transaction). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Whole-token USD amount → base units at a price, rounded down. */
export function usdToBaseUnits(usd: number, priceUsd: number, decimals: number): bigint {
  if (!(usd > 0) || !(priceUsd > 0)) return 0n;
  const tokens = usd / priceUsd;
  // Split into whole and fractional parts to keep precision for large amounts.
  const whole = Math.floor(tokens);
  const frac = Math.floor((tokens - whole) * 10 ** decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac);
}
