import type { CoinInfo } from "./types.js";

// The platform's payout address per coin: where the pool pays everything our users mine. It is the
// first half of every pool login (`<payout address>.<worker id>-<gpu>`, see `poolUser`), so a wrong
// one sends the coin to someone else. Set it per deployment, not in the repo:
//   HASH_PAYOUT_ADDRESS_PRL=prl1...   (one variable per coin id)
// `services/api/config/coins.json` keeps a test address for devnet; it is marked `payoutAddressIsTest`
// and refused in production.

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const FORMATS: Record<string, RegExp> = {
  // Pearl: bech32(m) with the "prl" prefix, e.g. prl1p... (63 characters for a taproot address).
  PRL: new RegExp(`^prl1[${BECH32}]{38,87}$`),
  // Quantus: a 49-character address starting with "q" (base58).
  QUAN: /^q[1-9A-HJ-NP-Za-km-z]{48}$/,
};

/** Whether `address` looks like a payout address for the coin (and can't break the pool login). */
export function isPayoutAddress(coinId: string, address: string): boolean {
  const f = FORMATS[coinId];
  if (f) return f.test(address);
  // Unknown coin: at least nothing that would change the login's meaning (`.` separates the worker).
  return /^[A-Za-z0-9_-]{20,128}$/.test(address);
}

export interface PayoutAddressResult {
  coins: CoinInfo[];
  /** What came from where, and which coins were switched off for lack of an address. */
  notes: string[];
}

/**
 * Apply `HASH_PAYOUT_ADDRESS_<COIN>` overrides to the coin list. In production a coin keeps no test
 * address: without an override it gets no payout address, so it is never assigned. A malformed
 * address throws (better to refuse to start than to mine into the wrong wallet).
 */
export function applyPayoutAddresses(coins: CoinInfo[], env: Record<string, string | undefined>, opts: { production: boolean }): PayoutAddressResult {
  const notes: string[] = [];
  const out = coins.map((c) => {
    const override = env[`HASH_PAYOUT_ADDRESS_${c.id}`]?.trim();
    if (override) {
      if (!isPayoutAddress(c.id, override)) throw new Error(`HASH_PAYOUT_ADDRESS_${c.id} is not a valid ${c.id} address`);
      notes.push(`${c.id}: payout address from HASH_PAYOUT_ADDRESS_${c.id}`);
      return { ...c, payoutAddress: override, payoutAddressIsTest: false };
    }
    if (!c.payoutAddress) return c;
    if (opts.production && c.payoutAddressIsTest) {
      notes.push(`${c.id}: the configured payout address is a test address; set HASH_PAYOUT_ADDRESS_${c.id} (not assigned until then)`);
      const { payoutAddress: _drop, ...rest } = c;
      return rest;
    }
    if (!isPayoutAddress(c.id, c.payoutAddress)) throw new Error(`${c.id}: payoutAddress in the config is not a valid ${c.id} address`);
    notes.push(`${c.id}: payout address from the config${c.payoutAddressIsTest ? " (test address)" : ""}`);
    return c;
  });
  return { coins: out, notes };
}
