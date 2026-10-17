// Payouts whose transaction was sent but never confirmed to us: the loop crashed or was stopped right
// after sending, or the confirmation timed out. Such a transaction may have landed, so retrying it
// blindly could pay twice. Each one is recorded on its owed entries before it is sent (`inFlight`);
// before the next round plans anything, this looks each one up on chain:
//   landed          → recorded as paid (never sent again)
//   failed          → retried this round
//   not found and its blockhash expired (it can never land) → retried this round
//   not found, still valid → wait for it (a minute or two at most), then decide
import type { Ledger } from "./ledger.js";
import { recordSent } from "./round.js";

export interface InFlightChain {
  /** Statuses for these signatures, searching the transaction history (null: not found). */
  statuses(signatures: string[]): Promise<({ err: unknown; confirmationStatus?: string | null } | null)[]>;
  blockHeight(): Promise<number>;
}

export interface InFlightResult { landed: number; retry: number; signatures: string[] }

export async function resolveInFlight(
  l: Ledger, chain: InFlightChain,
  x: { now: number; decimals: number; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<InFlightResult> {
  const sleep = x.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const result: InFlightResult = { landed: 0, retry: 0, signatures: [] };
  const deadline = Date.now() + (x.waitMs ?? 120_000);
  for (;;) {
    const open = l.owed.filter((o) => o.inFlight);
    if (!open.length) return result;
    const sigs = [...new Set(open.map((o) => o.inFlight!.signature))];
    const [statuses, height] = await Promise.all([chain.statuses(sigs), chain.blockHeight()]);
    let waiting = 0;
    sigs.forEach((sig, i) => {
      const s = statuses[i];
      const entries = l.owed.filter((o) => o.inFlight?.signature === sig);
      const landed = s && !s.err && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized");
      if (landed) {
        for (const e of entries) recordSent(l, e, BigInt(e.tokens ?? "0"), { now: x.now, decimals: x.decimals });
        result.landed += entries.length;
        result.signatures.push(sig);
      } else if ((s && s.err) || (!s && height > entries[0]!.inFlight!.lastValidBlockHeight)) {
        for (const e of entries) delete e.inFlight;
        result.retry += entries.length;
      } else waiting += 1;
    });
    if (!waiting) return result;
    if (Date.now() >= deadline) throw new Error(`${waiting} payout transaction(s) still unconfirmed and not expired; the round waits so nothing is paid twice`);
    await sleep(x.pollMs ?? 5_000);
  }
}
