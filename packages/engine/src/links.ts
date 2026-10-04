import { advanceClock, applyBalanceChange, clockStartTokens, type PriceContext, type WalletState } from "./levels.js";
import type { Rules } from "./rules.js";

/**
 * Wallet linking: a holder proves two wallets are theirs by signing a message with each (free, no
 * transaction). Linked wallets form one group with one bag, and one hold clock, and
 * transfers inside the group don't touch the clock (they still pay the 5% tax).
 *
 * The group is tracked as a single WalletState: `address` is the group's id (its first wallet),
 * `balance` is the sum of its wallets. Chain-watch skips transfers whose sender and receiver are in
 * the same group, and applies every other transfer to the group with `applyBalanceChange`.
 */

/**
 * Link a wallet into a group. The clocks merge weighted by bag, so linking a fresh or a friend's
 * wallet can't hand out an aged clock: an aged $2,500 group plus a fresh $7,500 wallet keeps 25% of
 * its clock. A wallet whose clock hasn't started counts as clock 0.
 */
export function linkWallet(group: WalletState, wallet: WalletState, at: number, p: PriceContext, rules: Rules): WalletState {
  const g = advanceClock(group, at, p, rules);
  const w = advanceClock(wallet, at, p, rules);
  const balance = g.balance + w.balance;
  let clockMs: number | null;
  if (balance === 0n) {
    clockMs = null;
  } else if (g.clockMs === null && w.clockMs === null) {
    clockMs = balance >= clockStartTokens(p, rules) ? 0 : null;
  } else {
    const gb = Number(g.balance), wb = Number(w.balance);
    clockMs = ((g.clockMs ?? 0) * gb + (w.clockMs ?? 0) * wb) / (gb + wb);
  }
  return { address: g.address, balance, clockMs, clockAt: at };
}

/**
 * Unlink a wallet holding `walletBalance` (base units) from a group. It counts as that wallet
 * selling its share of the group (the group's clock takes the sell penalty), and the wallet starts
 * over on its own, so linking then unlinking can't copy a clock.
 */
export function unlinkWallet(
  group: WalletState,
  wallet: { address: string; balance: bigint },
  at: number,
  p: PriceContext,
  rules: Rules,
): { group: WalletState; wallet: WalletState } {
  const rest = applyBalanceChange(group, -wallet.balance, at, p, rules);
  const fresh = applyBalanceChange({ address: wallet.address, balance: 0n, clockMs: null, clockAt: at }, wallet.balance, at, p, rules);
  return { group: rest, wallet: fresh };
}

/** True when a transfer stays inside one linked group, so it isn't a sale. */
export function isInternalTransfer(from: string, to: string, groupOf: (address: string) => string | undefined): boolean {
  const a = groupOf(from);
  return a !== undefined && a === groupOf(to);
}
