// One payout round, planned without touching the chain: split the tax, run the miner epoch and
// the holder payout, settle mining that has matured. `commitRound` then records what was sent.
import {
  runEpoch, runHolderPayout, settle, splitTax,
  type EpochResult, type HolderPayoutResult, type PriceContext, type Rules, type TaxSplit,
} from "@hashcoin/engine";
import { addBig, day, type Ledger, type Owed, walletState } from "./ledger.js";

export interface RoundInput {
  ledger: Ledger;
  now: number;
  roundId: string;
  /** Tax from trading harvested this round (tokens, base units). */
  taxTokens: bigint;
  /** The tax rate in force (bps). */
  rateBps: number;
  price: PriceContext;
  rules: Rules;
  /** Never paid as holders or miners: treasury, dev, liquidity pools, exchanges. */
  excluded: ReadonlySet<string>;
  dev: string;
  /** Pay holders this round (they can be paid less often than miners). */
  payHolders: boolean;
  /**
   * Devnet only: mining held back (25%) is settled at its estimate after this long, since there is
   * no real coin sale. On mainnet the settler uses actual sale proceeds instead.
   */
  settleAtEstimateAfterMs: number;
  /** Holder lines below this roll into the next payout (a new token account costs rent). */
  minHolderPayoutUsd: number;
}

export type PlannedPayout = Owed;

export interface RoundPlan {
  roundId: string;
  taxUsd: number;
  minedUsd: number;
  split: TaxSplit;
  epoch: EpochResult;
  holders: HolderPayoutResult | null;
  settledIds: Set<number>;
  payouts: PlannedPayout[];
  chestCarryUsd: number;
  holderCarryUsd: number;
}

const usd = (n: number) => `$${n.toFixed(4)}`;

export function planRound(x: RoundInput): RoundPlan {
  const l = x.ledger;
  const taxUsd = (Number(x.taxTokens) / 10 ** x.price.decimals) * x.price.priceUsd;
  const earnings = new Map(Object.entries(l.minedSinceRound).filter(([, v]) => v > 0));
  const minedUsd = [...earnings.values()].reduce((a, v) => a + v, 0);
  const split = splitTax({ taxUsd, rate: x.rateBps / 10_000, minedUsd, chestCarryUsd: l.chestCarryUsd }, x.rules);

  const epoch = runEpoch({
    epochId: x.roundId, now: x.now, earnings,
    hoursMined: new Map(Object.entries(l.hoursInWindow)),
    wallets: new Map([...earnings.keys()].map((a) => [a, walletState(a, l.wallets[a])])),
    price: x.price, chestUsd: split.chestUsd + l.chestCarryUsd, floatAvailableUsd: Number.MAX_SAFE_INTEGER,
    rules: x.rules, excluded: x.excluded,
  });

  const potUsd = split.holderUsd + l.holderCarryUsd;
  const holders = x.payHolders
    ? runHolderPayout({ now: x.now, potUsd, wallets: Object.entries(l.wallets).map(([a, w]) => walletState(a, w)), price: x.price, rules: x.rules, excluded: x.excluded })
    : null;
  let holderCarryUsd = holders ? holders.carryUsd : potUsd;

  // Anything that failed to send last time goes first.
  const payouts: PlannedPayout[] = l.owed.map((o) => ({ ...o, why: `retry: ${o.why.replace(/^retry: /, "")}` }));
  for (const m of epoch.lines) {
    payouts.push({
      address: m.address, usd: m.payNowUsd, kind: "miner",
      why: `M${m.level} (H${m.holderLevel}): mined ${usd(m.immediateUsd)} now of ${usd(m.miningUsd)} + bonus ${usd(m.chestUsd)}`,
    });
  }
  for (const h of holders?.lines ?? []) {
    if (h.usd < x.minHolderPayoutUsd) { holderCarryUsd += h.usd; continue; }
    payouts.push({ address: h.address, usd: h.usd, kind: "holder", why: `H${h.holderLevel}: ${usd(h.balanceUsd)} bag, ${(100 * h.share).toFixed(2)}% of the pot` });
  }
  if (split.devUsd > 0) payouts.push({ address: x.dev, usd: split.devUsd, kind: "dev", why: `dev ${(100 * split.shares.dev).toFixed(2)}% of the tax` });

  // Held-back mining that has matured. Devnet: at its estimate (ratio 1).
  const settledIds = new Set<number>();
  const due = l.pending.flatMap((p, i) => (x.now - p.at >= x.settleAtEstimateAfterMs ? [{ p, i }] : []));
  if (due.length) {
    const s = settle(due.map((d) => d.p), due.reduce((a, d) => a + d.p.miningUsd, 0));
    s.lines.forEach((line, k) => {
      settledIds.add(due[k]!.i);
      if (line.payUsd > 0) payouts.push({ address: line.address, usd: line.payUsd, kind: "settle", why: `held-back mining from ${due[k]!.p.epochId}` });
    });
  }

  return { roundId: x.roundId, taxUsd, minedUsd, split, epoch, holders, settledIds, payouts: payouts.filter((p) => p.usd > 0), chestCarryUsd: epoch.carryUsd, holderCarryUsd };
}

/**
 * Record a round: carries, held-back mining, totals. `sent` is tokens received per payout, in plan
 * order; a payout with no entry (its transaction failed) is owed and retried next round.
 */
export function commitRound(l: Ledger, plan: RoundPlan, x: { now: number; taxTokens: bigint; decimals: number }, sent: (bigint | undefined)[]) {
  l.round += 1;
  l.lastRoundAt = x.now;
  l.chestCarryUsd = plan.chestCarryUsd;
  l.holderCarryUsd = plan.holderCarryUsd;
  l.minedSinceRound = {};
  l.pending = [
    ...l.pending.filter((_, i) => !plan.settledIds.has(i)),
    ...plan.epoch.pending.map((p) => ({ ...p, at: x.now })),
  ];
  const d = day(l, x.now);
  const tokens = (b: bigint) => Number(b) / 10 ** x.decimals;
  d.taxTokens += tokens(x.taxTokens);
  l.totals.taxTokens = addBig(l.totals.taxTokens, x.taxTokens);
  l.owed = plan.payouts.filter((_, i) => sent[i] === undefined);
  plan.payouts.forEach((p, i) => {
    const amount = sent[i];
    if (amount === undefined) return;
    d.paidTokens += tokens(amount);
    if (p.kind === "dev") { l.totals.devTokens = addBig(l.totals.devTokens, amount); return; }
    const w = (l.paid[p.address] ??= { miner: "0", holder: "0" });
    if (p.kind === "holder") { w.holder = addBig(w.holder, amount); l.totals.holderTokens = addBig(l.totals.holderTokens, amount); }
    else { w.miner = addBig(w.miner, amount); l.totals.minerTokens = addBig(l.totals.minerTokens, amount); }
  });
}
