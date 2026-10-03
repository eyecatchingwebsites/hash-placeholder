import { computeHolderLevel, positionUsd, type PriceContext, type WalletState } from "./levels.js";
import type { HolderLevel, Rules } from "./rules.js";
import { holderShares } from "./weights.js";

export interface HolderPayoutInput {
  now: number;
  /** Holder pot to distribute (USD), plus anything carried from earlier payouts. */
  potUsd: number;
  /** Every wallet holding $HASH. */
  wallets: Iterable<WalletState>;
  price: PriceContext;
  rules: Rules;
  /** Dev, treasury, payout, liquidity pool and exchange wallets: never paid. */
  excluded?: ReadonlySet<string>;
}

export interface HolderPayoutLine {
  address: string;
  holderLevel: HolderLevel;
  balanceUsd: number;
  share: number;
  usd: number;
}

export interface HolderPayoutResult {
  lines: HolderPayoutLine[];
  /** Pot not distributed (wallet caps, no eligible holders); add it to the next payout. */
  carryUsd: number;
  paidUsd: number;
}

/** Split the holder pot by bag × holder level (H1-H3), each wallet capped. */
export function runHolderPayout(input: HolderPayoutInput): HolderPayoutResult {
  const { rules, price, now } = input;
  const entries = [];
  for (const w of input.wallets) {
    if (input.excluded?.has(w.address)) continue;
    const level = computeHolderLevel(w, price, now, rules);
    if (level === 0) continue;
    entries.push({ address: w.address, level, balanceUsd: positionUsd(w.balance, price) });
  }
  const shares = holderShares(entries, rules);
  const lines = entries
    .map((e) => {
      const share = shares.get(e.address) ?? 0;
      return { address: e.address, holderLevel: e.level, balanceUsd: e.balanceUsd, share, usd: input.potUsd * share };
    })
    .filter((l) => l.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  const paidUsd = lines.reduce((a, l) => a + l.usd, 0);
  return { lines, carryUsd: Math.max(0, input.potUsd - paidUsd), paidUsd };
}
