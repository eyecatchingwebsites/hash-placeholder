// What the payout loop remembers between rounds. A JSON file for the devnet rehearsal; Postgres
// later (docs/TECHNICAL-PLAN.md, Phase 3). Token amounts are base units, stored as strings.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { PendingRecord, WalletState } from "@hashcoin/engine";

/** A payout that failed to send; paid first next round. */
export interface Owed { address: string; usd: number; kind: "miner" | "holder" | "dev" | "settle"; why: string }

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
  /** Fees our own payouts paid that haven't been harvested back yet: they return to the treasury, not the pot. */
  ownFeesUnharvested: string;
  owed: Owed[];
  days: Record<string, DayStats>;
  rateChanges: { at: number; bps: number; effectiveEpoch?: number; reason: string; signature?: string }[];
  paid: Record<string, { miner: string; holder: string }>;
  totals: { minerTokens: string; holderTokens: string; devTokens: string; taxTokens: string; volumeTokens: string };
}

export function emptyLedger(network: string, mint: string): Ledger {
  return {
    version: 1, network, mint, round: 0, lastRoundAt: 0, startedAt: Number.MAX_SAFE_INTEGER, indexedTx: 0, wallets: {}, tokenAccounts: [],
    minedSinceRound: {}, hoursInWindow: {}, chestCarryUsd: 0, holderCarryUsd: 0, pending: [], ownFeesUnharvested: "0", owed: [],
    days: {}, rateChanges: [], paid: {}, totals: { minerTokens: "0", holderTokens: "0", devTokens: "0", taxTokens: "0", volumeTokens: "0" },
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

export function loadLedger(path: string): Ledger | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Ledger;
}

/** Write to a temp file, then rename, so a crash mid-write can't corrupt the ledger. */
export function saveLedger(path: string, l: Ledger) {
  writeFileSync(`${path}.tmp`, JSON.stringify(l));
  renameSync(`${path}.tmp`, path);
}
