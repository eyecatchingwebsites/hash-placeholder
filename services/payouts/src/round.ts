// One payout round, planned without touching the chain: split the tax, run the miner epoch and
// the holder payout, settle held-back mining that has been funded. `commitRound` then records what
// was sent.
//
// Where the money comes from:
// - Miners' mining value is bought on the market with SOL from the float (launch day: our curve
//   trading fee; later: the mined coin's sale). That part of a payout is `buyUsd`. The engine pays
//   at most what the float can fund now; the rest is held back ("pending") until the coin is sold.
// - The miner bonus (chest), holder rewards and the dev share are paid from the harvested tax,
//   which is already $HASH.
import {
  runEpoch, runHolderPayout, settle, splitTax,
  type EpochResult, type HolderPayoutResult, type PriceContext, type Rules, type TaxSplit,
} from "@hashcoin/engine";
import { addBig, day, type Ledger, type Owed, walletState } from "./ledger.js";

export interface SettlementRule {
  /** "sales": pay held-back mining from recorded coin sales; "estimate": at its estimate (devnet). */
  mode: "sales" | "estimate";
  /** Held-back mining younger than this isn't settled yet (the mined coin needs to confirm). */
  minAgeMs: number;
  /** "sales": USD of sale proceeds not yet paid out. */
  budgetUsd: number;
  /** "sales": what the coin sold for relative to the collector's estimate (1 = as estimated). */
  ratio: number;
}

export interface RoundInput {
  ledger: Ledger;
  now: number;
  roundId: string;
  /** Tax from trading harvested this round (tokens, base units). */
  taxTokens: bigint;
  /** The tax rate in force (bps). */
  rateBps: number;
  /** Spot price: values the tax and converts USD to tokens. */
  price: PriceContext;
  /** Price for levels (the higher of the 1h and 7-day averages, docs/PROJECT.md §3). */
  levelPrice: PriceContext;
  rules: Rules;
  /** Never paid as holders or miners: treasury, dev, liquidity pools, exchanges. */
  excluded: ReadonlySet<string>;
  dev: string;
  /** Pay holders this round (they can be paid less often than miners). */
  payHolders: boolean;
  /** USD of mining the float can buy right now (the engine holds back the rest). */
  floatAvailableUsd: number;
  settlement: SettlementRule;
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
  /** USD of held-back mining settled this round (comes out of the sales budget). */
  settledUsd: number;
  payouts: PlannedPayout[];
  /** USD of $HASH to buy on the market this round (mining value only). */
  buyUsd: number;
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
    price: x.levelPrice, chestUsd: split.chestUsd + l.chestCarryUsd, floatAvailableUsd: Math.max(0, x.floatAvailableUsd),
    rules: x.rules, excluded: x.excluded,
  });

  const potUsd = split.holderUsd + l.holderCarryUsd;
  const holders = x.payHolders
    ? runHolderPayout({ now: x.now, potUsd, wallets: Object.entries(l.wallets).map(([a, w]) => walletState(a, w)), price: x.levelPrice, rules: x.rules, excluded: x.excluded })
    : null;
  let holderCarryUsd = holders ? holders.carryUsd : potUsd;

  // Anything that failed to send (or couldn't be bought) last time goes first.
  const payouts: PlannedPayout[] = l.owed.map((o) => ({ ...o, why: `retry: ${o.why.replace(/^retry: /, "")}` }));
  for (const m of epoch.lines) {
    payouts.push({
      address: m.address, usd: m.payNowUsd, buyUsd: m.immediateUsd, kind: "miner",
      why: `M${m.level} (H${m.holderLevel}): mined ${usd(m.immediateUsd)} now of ${usd(m.miningUsd)} + bonus ${usd(m.chestUsd)}`,
    });
  }
  for (const h of holders?.lines ?? []) {
    if (h.usd < x.minHolderPayoutUsd) { holderCarryUsd += h.usd; continue; }
    payouts.push({ address: h.address, usd: h.usd, kind: "holder", why: `H${h.holderLevel}: ${usd(h.balanceUsd)} bag, ${(100 * h.share).toFixed(2)}% of the pot` });
  }
  if (split.devUsd > 0) payouts.push({ address: x.dev, usd: split.devUsd, kind: "dev", why: `dev ${(100 * split.shares.dev).toFixed(2)}% of the tax` });

  // Held-back mining, oldest first, once old enough and (on mainnet) once a sale has funded it.
  const settledIds = new Set<number>();
  let settledUsd = 0;
  const due = l.pending.flatMap((p, i) => (x.now - p.at >= x.settlement.minAgeMs ? [{ p, i }] : [])).sort((a, b) => a.p.at - b.p.at);
  const ratio = x.settlement.mode === "estimate" ? 1 : x.settlement.ratio;
  for (const { p, i } of due) {
    const line = settle([p], p.miningUsd * ratio).lines[0]!;
    if (x.settlement.mode === "sales" && settledUsd + line.payUsd > x.settlement.budgetUsd + 1e-9) break;
    settledIds.add(i);
    settledUsd += line.payUsd;
    if (line.payUsd > 0) payouts.push({ address: line.address, usd: line.payUsd, buyUsd: line.payUsd, kind: "settle", why: `held-back mining from ${p.epochId}${ratio !== 1 ? ` at ${ratio.toFixed(3)}x (coin sale)` : ""}` });
  }

  const kept = payouts.filter((p) => p.usd > 0 || (p.tokens && BigInt(p.tokens) > 0n));
  const buyUsd = kept.reduce((a, p) => a + (p.tokens ? 0 : p.buyUsd ?? 0), 0);
  return { roundId: x.roundId, taxUsd, minedUsd, split, epoch, holders, settledIds, settledUsd, payouts: kept, buyUsd, chestCarryUsd: epoch.carryUsd, holderCarryUsd };
}

/**
 * Tokens for each payout. The bought tokens go to the mining parts in proportion to their USD (so
 * miners get exactly what their mining bought, at the price actually paid); the tax-funded rest is
 * converted at the spot price (or kept from an earlier round). A retry that already had its tokens
 * keeps them. With `bought` null (no buy this round: it failed or was refused) a payout that needed
 * buying has no `total` and stays owed, its tax-funded part fixed in `fromTax`.
 */
export function payoutParts(payouts: PlannedPayout[], bought: bigint | null, toTokens: (usd: number) => bigint): { total?: bigint; fromTax: bigint }[] {
  const shares = allocate(bought ?? 0n, payouts.map((p) => (p.tokens ? 0 : p.buyUsd ?? 0)));
  return payouts.map((p, i) => {
    if (p.tokens) return { total: BigInt(p.tokens), fromTax: 0n };
    const buyPart = p.buyUsd ?? 0;
    const fromTax = p.taxTokens ? BigInt(p.taxTokens) : toTokens(Math.max(0, p.usd - buyPart));
    if (buyPart > 0 && bought === null) return { fromTax };
    return { total: fromTax + shares[i]!, fromTax };
  });
}

/** Just the totals of `payoutParts` (undefined: waits for a buy). */
export function payoutTokens(payouts: PlannedPayout[], bought: bigint | null, toTokens: (usd: number) => bigint): (bigint | undefined)[] {
  return payoutParts(payouts, bought, toTokens).map((x) => x.total);
}

/** Split `total` in proportion to `weights`, rounding down, remainder to the largest weight. */
export function allocate(total: bigint, weights: number[]): bigint[] {
  // Weights are USD: as integer micro-cents, so the split is exact integer arithmetic.
  const w = weights.map((x) => BigInt(Math.round(Math.max(0, x) * 1e8)));
  const sum = w.reduce((a, b) => a + b, 0n);
  if (total <= 0n || sum <= 0n) return weights.map(() => 0n);
  const out = w.map((x) => (total * x) / sum);
  const rest = total - out.reduce((a, b) => a + b, 0n);
  const biggest = weights.indexOf(Math.max(...weights));
  out[biggest] = out[biggest]! + rest;
  return out;
}

/**
 * Record a round before anything is sent (write-ahead): carries, held-back mining, totals, and every
 * payout as owed, with its tokens once funded (`amounts[i]`; undefined: couldn't be bought). Each
 * transfer that lands is then cleared with `recordSent`. A crash mid-round leaves the rest owed, to
 * be paid next round with the same tokens, instead of losing track of tax or bought $HASH.
 * Returns the owed entries in plan order.
 */
export function stageRound(l: Ledger, plan: RoundPlan, x: { now: number; taxTokens: bigint; decimals: number; settlementMode: "sales" | "estimate" }, amounts: (bigint | undefined)[], fromTax?: bigint[]): Owed[] {
  l.round += 1;
  l.lastRoundAt = x.now;
  l.chestCarryUsd = plan.chestCarryUsd;
  l.holderCarryUsd = plan.holderCarryUsd;
  l.minedSinceRound = {};
  l.taxUnallocated = "0";
  l.pending = [
    ...l.pending.filter((_, i) => !plan.settledIds.has(i)),
    ...plan.epoch.pending.map((p) => ({ ...p, at: x.now })),
  ];
  if (x.settlementMode === "sales") l.funding.saleBudgetUsd = Math.max(0, l.funding.saleBudgetUsd - plan.settledUsd);
  day(l, x.now).taxTokens += Number(x.taxTokens) / 10 ** x.decimals;
  l.totals.taxTokens = addBig(l.totals.taxTokens, x.taxTokens);
  l.owed = plan.payouts.map((p, i) => {
    const funded = amounts[i];
    if (funded !== undefined) return { ...p, tokens: funded.toString() };
    return fromTax?.[i] !== undefined ? { ...p, taxTokens: fromTax[i]!.toString() } : { ...p };
  });
  return [...l.owed];
}

/** A staged payout landed: `amount` tokens reached the recipient. */
export function recordSent(l: Ledger, entry: Owed, amount: bigint, x: { now: number; decimals: number }) {
  const i = l.owed.indexOf(entry);
  if (i < 0) return;
  l.owed.splice(i, 1);
  day(l, x.now).paidTokens += Number(amount) / 10 ** x.decimals;
  if (entry.kind === "dev") { l.totals.devTokens = addBig(l.totals.devTokens, amount); return; }
  const w = (l.paid[entry.address] ??= { miner: "0", holder: "0" });
  if (entry.kind === "holder") { w.holder = addBig(w.holder, amount); l.totals.holderTokens = addBig(l.totals.holderTokens, amount); }
  else { w.miner = addBig(w.miner, amount); l.totals.minerTokens = addBig(l.totals.minerTokens, amount); }
}

/** Stage a round and record what was sent in one go (tests, and the shape of a whole round). */
export function commitRound(l: Ledger, plan: RoundPlan, x: { now: number; taxTokens: bigint; decimals: number; settlementMode: "sales" | "estimate" }, amounts: (bigint | undefined)[], sent: (bigint | undefined)[], fromTax?: bigint[]) {
  const staged = stageRound(l, plan, x, amounts, fromTax);
  staged.forEach((e, i) => { if (sent[i] !== undefined) recordSent(l, e, sent[i]!, x); });
}
