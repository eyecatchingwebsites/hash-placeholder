// The public record: totals, the tax rate, recent rounds with their transactions, and each
// wallet's levels and what it has been paid. Served by services/api (/v1/stats, /v1/wallet/:address).
import { computeHolderLevel, computeMinerLevel, holdClockMs, positionUsd, type PriceContext, type Rules } from "@hashcoin/engine";
import { DAY_MS } from "@hashcoin/engine";
import { dayKey, type Ledger, walletState } from "./ledger.js";

export interface RoundSummary {
  round: number;
  at: string;
  rateBps: number;
  taxUsd: number;
  minedUsd: number;
  split: { devUsd: number; chestUsd: number; holderUsd: number };
  miners: number;
  holders: number;
  paidTokens: number;
  transactions: string[];
}

/** Where trading happens and how the miners' buys are funded, for the site and the app. */
export interface MarketStatus {
  phase: "curve" | "graduating" | "damm" | "none";
  priceSol?: number;
  solUsd?: number;
  curveProgress?: number;
  /** SOL in the payout wallet above its reserve, available to buy miners' $HASH. */
  floatSol: number;
  floatUsd: number;
}

export function publicRecord(l: Ledger, x: {
  now: number; price: PriceContext; levelPrice?: PriceContext; rules: Rules; excluded: ReadonlySet<string>; explorer: (sig: string) => string;
  rate: { bps: number; scheduled?: { bps: number; epoch: number } }; rounds: RoundSummary[]; market?: MarketStatus;
}) {
  const levelPrice = x.levelPrice ?? x.price;
  const tokens = (s: string) => Number(BigInt(s)) / 10 ** x.price.decimals;
  const last = (n: number) => {
    let volume = 0, mined = 0, tax = 0, paid = 0;
    for (let i = 0; i < n; i++) {
      const d = l.days[dayKey(x.now - i * DAY_MS)];
      if (d) { volume += d.volumeTokens; mined += d.minedUsd; tax += d.taxTokens; paid += d.paidTokens; }
    }
    return { volumeUsd: volume * x.price.priceUsd, minedUsd: mined, taxUsd: tax * x.price.priceUsd, paidUsd: paid * x.price.priceUsd };
  };
  const wallets = Object.fromEntries(Object.entries(l.wallets).filter(([a]) => !x.excluded.has(a)).map(([a, s]) => {
    const w = walletState(a, s);
    const holderLevel = computeHolderLevel(w, levelPrice, x.now, x.rules);
    const hours = l.hoursInWindow[a] ?? 0;
    const paid = l.paid[a] ?? { miner: "0", holder: "0" };
    return [a, {
      balanceTokens: tokens(s.balance), balanceUsd: positionUsd(w.balance, x.price),
      holderLevel, minerLevel: hours > 0 ? computeMinerLevel(hours, holderLevel, x.rules) : null,
      holdClockHours: holdClockMs(w, x.now, levelPrice, x.rules) / 3_600_000, hoursMinedInWindow: hours,
      paidTokens: { miner: tokens(paid.miner), holder: tokens(paid.holder) },
      // Held-back mining (paid once the mined coin sells) plus payouts that failed and will be retried.
      pendingUsd: l.pending.filter((p) => p.address === a).reduce((s, p) => s + p.estimatedUsd, 0) + l.owed.filter((o) => o.address === a).reduce((s, o) => s + o.usd, 0),
    }];
  }));
  return {
    network: l.network, mint: l.mint, updatedAt: new Date(x.now).toISOString(), round: l.round, priceUsd: x.price.priceUsd, levelPriceUsd: levelPrice.priceUsd,
    market: x.market ?? null,
    funding: {
      partnerFeesClaimedSol: Number(BigInt(l.funding.partnerFeesLamports)) / 1e9,
      spentOnBuysSol: Number(BigInt(l.funding.spentLamports)) / 1e9,
      boughtForMinersTokens: tokens(l.funding.boughtTokens),
      saleProceedsWaitingUsd: l.funding.saleBudgetUsd,
      buys: l.funding.buys.slice(-20).reverse().map((b) => ({ ...b, at: new Date(b.at).toISOString(), tx: x.explorer(b.signature) })),
    },
    taxRate: { bps: x.rate.bps, scheduled: x.rate.scheduled ?? null, changes: l.rateChanges.map((c) => ({ ...c, at: new Date(c.at).toISOString(), tx: c.signature ? x.explorer(c.signature) : undefined })) },
    totals: {
      paidToMinersTokens: tokens(l.totals.minerTokens), paidToHoldersTokens: tokens(l.totals.holderTokens), paidToDevTokens: tokens(l.totals.devTokens),
      taxTokens: tokens(l.totals.taxTokens), rounds: l.round, indexedTransactions: l.indexedTx,
    },
    last24h: last(1), last7d: last(7),
    carry: { minerBonusUsd: l.chestCarryUsd, holderPotUsd: l.holderCarryUsd, heldBackMiningUsd: l.pending.reduce((a, p) => a + p.estimatedUsd, 0) },
    rounds: x.rounds.slice(-50).reverse().map((r) => ({ ...r, transactions: r.transactions.map(x.explorer) })),
    wallets,
  };
}
