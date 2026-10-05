// Transfer indexer: replays every mint transaction into wallet balances and hold clocks.
// Any outflow counts as selling (docs/PROJECT.md: transfers between your own wallets need linking).
import { applyBalanceChange, type PriceContext, type Rules } from "@hashcoin/engine";
import type { MintTx } from "@hashcoin/chain";
import { addBig, day, type Ledger, storeWallet, walletState } from "./ledger.js";

export interface IndexContext {
  price: PriceContext;
  rules: Rules;
  /** Treasury and dev: their transfers are payouts and funding, not trading, and they have no hold clock. */
  platform: ReadonlySet<string>;
}

/**
 * Apply transactions (oldest first) to the ledger. Returns the outside trading volume they carried
 * (tokens). A transfer the treasury or dev sends pays its fee from platform money, so that fee is
 * marked to go back to the treasury when harvested, not into the reward pot.
 */
export function indexTransactions(l: Ledger, txs: MintTx[], ctx: IndexContext): bigint {
  const accounts = new Set(l.tokenAccounts);
  let volume = 0n;
  for (const tx of txs) {
    const live = tx.at >= l.startedAt;
    let txVolume = 0n, net = 0n, platformSent = false;
    for (const d of tx.deltas) {
      net += d.delta;
      if (d.delta < 0n && ctx.platform.has(d.owner)) platformSent = true;
      accounts.add(d.account);
      if (!d.owner || ctx.platform.has(d.owner)) continue;
      if (d.delta < 0n) txVolume -= d.delta;
      const before = l.wallets[d.owner];
      const after = applyBalanceChange(walletState(d.owner, before), d.delta, tx.at, ctx.price, ctx.rules);
      l.wallets[d.owner] = storeWallet(after, before?.firstAt ?? tx.at);
    }
    // Fees are withheld out of the moved amount, so balances shrink by the fee: net < 0.
    if (live && platformSent && net < 0n) l.ownFeesUnharvested = addBig(l.ownFeesUnharvested, -net);
    if (!live) txVolume = 0n;
    if (txVolume > 0n) day(l, tx.at).volumeTokens += Number(txVolume) / 10 ** ctx.price.decimals;
    volume += txVolume;
    l.lastSignature = tx.signature;
    l.indexedTx += 1;
  }
  l.tokenAccounts = [...accounts];
  l.totals.volumeTokens = addBig(l.totals.volumeTokens, volume);
  return volume;
}
