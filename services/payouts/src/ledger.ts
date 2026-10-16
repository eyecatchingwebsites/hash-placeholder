// What the payout loop remembers between rounds. A JSON file for the devnet rehearsal; Postgres
// later (docs/TECHNICAL-PLAN.md, Phase 3). Token amounts are base units, stored as strings.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { levelPriceUsd, type PendingRecord, type WalletState } from "@hashcoin/engine";

/** A payout that failed to send (or couldn't be bought); paid first next round. */
export interface Owed {
  address: string;
  usd: number;
  kind: "miner" | "holder" | "dev" | "settle";
  why: string;
  /** The part of `usd` that is mining value, bought on the market. */
  buyUsd?: number;
  /** Exact tokens, once they were bought or set aside (base units): a retry pays these. */
  tokens?: string;
  /**
   * When the buy didn't happen: the tax-funded part (bonus, holder share) already in tokens at the
   * price of the round that harvested it, so a retry doesn't re-price it. Only `buyUsd` is bought later.
   */
  taxTokens?: string;
}

/** Where the SOL for buying miners' $HASH comes from, and what it bought. */
export interface Funding {
  /** Mined coin credited to miners and not yet sold, per coin: the collector's coins and their USD estimate. */
  unsold: Record<string, { coins: number; usd: number }>;
  /** Sale proceeds (USD) recorded with `ctl sold` and not yet paid out as held-back mining. */
  saleBudgetUsd: number;
  /** The latest sale's price relative to the collector's estimate (settles held-back mining). */
  saleRatio: number;
  sales: { at: number; coin: string; coins: number; usd: number; ratio: number; note?: string }[];
  /** Partner trading fees claimed from the curve (lamports). */
  partnerFeesLamports: string;
  claims: { at: number; lamports: string; signature: string }[];
  /** Market buys: SOL spent, $HASH received. */
  spentLamports: string;
  boughtTokens: string;
  buys: { at: number; round: number; phase: string; lamports: string; tokens: string; costBps: number; signature: string }[];
}

export interface StoredWallet { balance: string; clockMs: number | null; clockAt: number; firstAt: number }

/** One UTC day of activity, for the tax-rate formula and the public stats. */
export interface DayStats {
  /** Outside trading: tokens leaving any wallet that isn't the treasury or dev (pool sells to buyers, holders selling). */
  volumeTokens: number;
  /** Estimated USD mined by all GPUs (collector). */
  minedUsd: number;
  /** Tax harvested from trading (our own payouts' fees excluded), in tokens. */
  taxTokens: number;
  paidTokens: number;
}

export interface Ledger {
  version: 1;
  network: string;
  mint: string;
  round: number;
  lastRoundAt: number;
  /**
   * When the loop took over. Older transactions only rebuild balances and hold clocks; their
   * trading and fees belong to before (their tax was swept to the treasury at the start).
   */
  startedAt: number;
  /** Newest mint transaction the indexer has processed. */
  lastSignature?: string;
  indexedTx: number;
  wallets: Record<string, StoredWallet>;
  /** Every token account of the mint the indexer has seen (where withheld tax can sit). */
  tokenAccounts: string[];
  /** USD each wallet has mined since the last payout round. */
  minedSinceRound: Record<string, number>;
  /** Latest credited mining hours in the M-level window, per wallet. */
  hoursInWindow: Record<string, number>;
  chestCarryUsd: number;
  holderCarryUsd: number;
  /** Mining paid later, once the mined coin confirms and sells (25% by default). */
  pending: (PendingRecord & { at: number })[];
  /** Tax harvested but not yet split (saved straight after the harvest, so a crash can't lose it). */
  taxUnallocated: string;
  /** Fees our own payouts paid that haven't been harvested back yet: they return to the treasury, not the pot. */
  ownFeesUnharvested: string;
  owed: Owed[];
  funding: Funding;
  /** Where trading happened last round (curve, graduating, damm), to notice graduation. */
  marketPhase?: string;
  /** Rounds in a row whose harvest found no tax (alerting). */
  emptyHarvestRounds: number;
  /** Spot price samples (USD per token) for the level price: the higher of the 1h and 7-day averages. */
  prices: { at: number; usd: number }[];
  days: Record<string, DayStats>;
  /** `proposed`: sent to the multisig for signing rather than sent by us. */
  rateChanges: { at: number; bps: number; effectiveEpoch?: number; reason: string; signature?: string; proposed?: string }[];
  paid: Record<string, { miner: string; holder: string }>;
  totals: { minerTokens: string; holderTokens: string; devTokens: string; taxTokens: string; volumeTokens: string };
}

export function emptyLedger(network: string, mint: string): Ledger {
  return {
    version: 1, network, mint, round: 0, lastRoundAt: 0, startedAt: Number.MAX_SAFE_INTEGER, indexedTx: 0, wallets: {}, tokenAccounts: [],
    minedSinceRound: {}, hoursInWindow: {}, chestCarryUsd: 0, holderCarryUsd: 0, pending: [], taxUnallocated: "0", ownFeesUnharvested: "0", owed: [],
    funding: emptyFunding(), emptyHarvestRounds: 0, prices: [], days: {}, rateChanges: [], paid: {}, totals: { minerTokens: "0", holderTokens: "0", devTokens: "0", taxTokens: "0", volumeTokens: "0" },
  };
}

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function day(l: Ledger, ms: number): DayStats {
  const k = dayKey(ms);
  return (l.days[k] ??= { volumeTokens: 0, minedUsd: 0, taxTokens: 0, paidTokens: 0 });
}

export const walletState = (address: string, w: StoredWallet | undefined): WalletState =>
  ({ address, balance: BigInt(w?.balance ?? "0"), clockMs: w?.clockMs ?? null, clockAt: w?.clockAt ?? 0 });

export const storeWallet = (w: WalletState, firstAt: number): StoredWallet =>
  ({ balance: w.balance.toString(), clockMs: w.clockMs, clockAt: w.clockAt, firstAt });

export const addBig = (a: string, b: bigint) => (BigInt(a) + b).toString();

export const emptyFunding = (): Funding => ({
  unsold: {}, saleBudgetUsd: 0, saleRatio: 1, sales: [], partnerFeesLamports: "0", claims: [], spentLamports: "0", boughtTokens: "0", buys: [],
});

export function loadLedger(path: string): Ledger | null {
  if (!existsSync(path)) return null;
  const l = JSON.parse(readFileSync(path, "utf8")) as Ledger;
  // Ledgers from before Oct 16 lack the funding and alerting fields.
  l.funding = { ...emptyFunding(), ...(l.funding ?? {}) };
  l.emptyHarvestRounds ??= 0;
  l.taxUnallocated ??= "0";
  l.prices ??= [];
  return l;
}

/** Keep a price sample per round (7 days) and return the level price from them. */
export function recordPrice(l: Ledger, at: number, usd: number): number {
  l.prices = [...l.prices.filter((p) => p.at > at - 7 * 86_400_000), { at, usd }];
  const avg = (ms: number) => { const xs = l.prices.filter((p) => p.at > at - ms); return xs.reduce((a, p) => a + p.usd, 0) / xs.length; };
  return levelPriceUsd(avg(3_600_000), avg(7 * 86_400_000));
}

/** Write to a temp file, then rename, so a crash mid-write can't corrupt the ledger. */
export function saveLedger(path: string, l: Ledger) {
  writeFileSync(`${path}.tmp`, JSON.stringify(l));
  renameSync(`${path}.tmp`, path);
}
