// On-chain actions for $HASH: a Token-2022 mint with the transfer-fee extension, fee harvesting,
// and batched payouts. Devnet first (packages/chain/scripts/devnet-run.ts).
import {
  type AccountInfo, type Connection, Keypair, type ParsedTransactionWithMeta, PublicKey, sendAndConfirmTransaction,
  SystemProgram, type TokenBalance, Transaction, type TransactionSignature,
} from "@solana/web3.js";
import {
  AuthorityType, createAssociatedTokenAccountIdempotentInstruction, createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction, createMintToInstruction, createSetAuthorityInstruction,
  createTransferCheckedWithFeeInstruction, ExtensionType, getAssociatedTokenAddressSync, getMint, getMintLen,
  getTransferFeeAmount, getTransferFeeConfig, harvestWithheldTokensToMint, setTransferFee, TOKEN_2022_PROGRAM_ID,
  unpackAccount, withdrawWithheldTokensFromMint,
} from "@solana/spl-token";
import { chunk, grossUp, transferFee } from "./fees.js";

const P = TOKEN_2022_PROGRAM_ID;

export interface HashMintConfig {
  decimals: number;
  /** Whole tokens, all minted once to `supplyTo`; then the mint authority is revoked. */
  supply: bigint;
  feeBps: number;
  /** Base units. */
  maxFee: bigint;
  /** Fee config authority (can change the fee; renounce after launch) and withdraw authority (collects the tax). */
  feeConfigAuthority: PublicKey;
  withdrawAuthority: PublicKey;
  supplyTo: PublicKey;
}

export const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, P);

/**
 * Create the mint: Token-2022 + transfer fee, no freeze authority, the whole supply minted once,
 * then the mint authority revoked so no more can ever be made. No other extensions.
 */
export async function createHashMint(conn: Connection, payer: Keypair, cfg: HashMintConfig): Promise<{ mint: PublicKey; signature: TransactionSignature }> {
  const mint = Keypair.generate();
  const space = getMintLen([ExtensionType.TransferFeeConfig]);
  const lamports = await conn.getMinimumBalanceForRentExemption(space);
  const dest = ata(cfg.supplyTo, mint.publicKey);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space, lamports, programId: P }),
    createInitializeTransferFeeConfigInstruction(mint.publicKey, cfg.feeConfigAuthority, cfg.withdrawAuthority, cfg.feeBps, cfg.maxFee, P),
    createInitializeMintInstruction(mint.publicKey, cfg.decimals, payer.publicKey, null, P),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, dest, cfg.supplyTo, mint.publicKey, P),
    createMintToInstruction(mint.publicKey, dest, payer.publicKey, cfg.supply * 10n ** BigInt(cfg.decimals), [], P),
    createSetAuthorityInstruction(mint.publicKey, payer.publicKey, AuthorityType.MintTokens, null, [], P),
  );
  const signature = await sendAndConfirmTransaction(conn, tx, [payer, mint]);
  return { mint: mint.publicKey, signature };
}

export interface Transfer { to: PublicKey; amount: bigint }

/**
 * Send transfers from `from`'s token account, several per transaction, creating recipients'
 * token accounts as needed. With `netOfFee`, each amount is grossed up so the recipient receives
 * exactly that amount after the 5% (the extra comes back via the harvest).
 */
export async function sendBatch(
  conn: Connection, payer: Keypair, from: Keypair, mint: PublicKey, decimals: number,
  fee: { bps: number; max: bigint }, transfers: Transfer[], opts: { netOfFee: boolean; perTx?: number } = { netOfFee: true },
): Promise<{ signature: TransactionSignature; transfers: (Transfer & { sent: bigint })[] }[]> {
  const source = ata(from.publicKey, mint);
  const out: { signature: TransactionSignature; transfers: (Transfer & { sent: bigint })[] }[] = [];
  for (const group of chunk(transfers.filter((t) => t.amount > 0n), opts.perTx ?? 5)) {
    const tx = new Transaction();
    const sent = group.map((t) => ({ ...t, sent: opts.netOfFee ? grossUp(t.amount, fee.bps, fee.max) : t.amount }));
    for (const t of sent) {
      const dest = ata(t.to, mint);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, dest, t.to, mint, P));
      tx.add(createTransferCheckedWithFeeInstruction(source, mint, dest, from.publicKey, t.sent, decimals, transferFee(t.sent, fee.bps, fee.max), [], P));
    }
    const signers = payer.publicKey.equals(from.publicKey) ? [payer] : [payer, from];
    out.push({ signature: await sendAndConfirmTransaction(conn, tx, signers), transfers: sent });
  }
  return out;
}

/**
 * Token accounts for this mint that hold withheld fees. Pass `candidates` (the token accounts the
 * transfer indexer has seen) on RPCs that don't allow scanning the Token-2022 program, such as
 * Solana's public endpoints; without it, every account of the mint is scanned.
 */
export async function accountsWithWithheldFees(conn: Connection, mint: PublicKey, candidates?: PublicKey[]): Promise<{ address: PublicKey; withheld: bigint }[]> {
  let accounts: { pubkey: PublicKey; account: AccountInfo<Buffer> }[];
  if (candidates) {
    accounts = [];
    for (const group of chunk(candidates, 100)) {
      const infos = await conn.getMultipleAccountsInfo(group);
      infos.forEach((account, i) => { if (account) accounts.push({ pubkey: group[i]!, account }); });
    }
  } else {
    accounts = [...await conn.getProgramAccounts(P, { filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] })];
  }
  return accounts.flatMap(({ pubkey, account }) => {
    if (!account.owner.equals(P)) return [];
    const parsed = unpackAccount(pubkey, account, P);
    if (!parsed.mint.equals(mint)) return [];
    const withheld = getTransferFeeAmount(parsed)?.withheldAmount ?? 0n;
    return withheld > 0n ? [{ address: pubkey, withheld }] : [];
  });
}

/**
 * Collect the tax: move withheld fees from token accounts into the mint (anyone may), then the
 * withdraw authority moves them from the mint to the treasury's token account.
 */
export async function harvestFees(
  conn: Connection, payer: Keypair, mint: PublicKey, withdrawAuthority: Keypair, treasury: PublicKey, candidates?: PublicKey[],
): Promise<{ harvested: bigint; signatures: TransactionSignature[] }> {
  const sources = await accountsWithWithheldFees(conn, mint, candidates);
  const signatures: TransactionSignature[] = [];
  for (const group of chunk(sources.map((s) => s.address), 20)) {
    signatures.push(await harvestWithheldTokensToMint(conn, payer, mint, group, undefined, P));
  }
  const dest = ata(treasury, mint);
  if (!(await conn.getAccountInfo(dest))) {
    signatures.push(await sendAndConfirmTransaction(conn, new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, dest, treasury, mint, P)), [payer]));
  }
  const before = (await conn.getTokenAccountBalance(dest)).value.amount;
  signatures.push(await withdrawWithheldTokensFromMint(conn, payer, mint, dest, withdrawAuthority, [], undefined, P));
  const after = (await conn.getTokenAccountBalance(dest)).value.amount;
  return { harvested: BigInt(after) - BigInt(before), signatures };
}

/**
 * The transfer fee in force now, and a scheduled change if one is waiting. Token-2022 applies a new
 * fee two epochs after it's set, and every transfer must state the fee exactly, so read this
 * before each batch rather than assuming a rate.
 */
export async function transferFeeNow(conn: Connection, mint: PublicKey): Promise<{
  bps: number; max: bigint; epoch: number; scheduled?: { bps: number; max: bigint; epoch: number };
}> {
  const [info, { epoch }] = await Promise.all([getMint(conn, mint, "confirmed", P), conn.getEpochInfo("confirmed")]);
  const cfg = getTransferFeeConfig(info);
  if (!cfg) return { bps: 0, max: 0n, epoch };
  const older = cfg.olderTransferFee, newer = cfg.newerTransferFee;
  const live = epoch >= Number(newer.epoch) ? newer : older;
  const out = { bps: live.transferFeeBasisPoints, max: live.maximumFee, epoch };
  return epoch < Number(newer.epoch)
    ? { ...out, scheduled: { bps: newer.transferFeeBasisPoints, max: newer.maximumFee, epoch: Number(newer.epoch) } }
    : out;
}

/** Schedule a new tax rate (fee config authority signs). It takes effect two epochs later, about 4 days. */
export async function setTaxRate(conn: Connection, payer: Keypair, mint: PublicKey, configAuthority: Keypair, bps: number, maxFee: bigint): Promise<TransactionSignature> {
  return setTransferFee(conn, payer, mint, configAuthority, [], bps, maxFee, undefined, P);
}

/** One indexed transaction: how each token account of the mint changed. */
export interface TokenDelta { owner: string; account: string; delta: bigint }
export interface MintTx { signature: string; at: number; deltas: TokenDelta[] }

/** Balance changes for `mint` in one parsed transaction, from its pre- and post-token balances. */
export function mintDeltas(tx: ParsedTransactionWithMeta, mint: string): TokenDelta[] {
  if (!tx.meta || tx.meta.err) return [];
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const byAccount = new Map<string, { owner: string; pre: bigint; post: bigint }>();
  const add = (list: TokenBalance[] | null | undefined, which: "pre" | "post") => {
    for (const b of list ?? []) {
      if (b.mint !== mint) continue;
      const account = keys[b.accountIndex]!;
      const e = byAccount.get(account) ?? { owner: b.owner ?? "", pre: 0n, post: 0n };
      e[which] = BigInt(b.uiTokenAmount.amount);
      if (b.owner) e.owner = b.owner;
      byAccount.set(account, e);
    }
  };
  add(tx.meta.preTokenBalances, "pre");
  add(tx.meta.postTokenBalances, "post");
  return [...byAccount].flatMap(([account, e]) => (e.post === e.pre ? [] : [{ owner: e.owner, account, delta: e.post - e.pre }]));
}

/**
 * Every transaction touching the mint since `untilSignature`, oldest first. Token-2022 requires
 * the mint on every transfer of a mint with a transfer fee, so this sees them all.
 */
export async function mintTransactionsSince(
  conn: Connection, mint: PublicKey, untilSignature?: string, opts: { maxTx?: number; pauseMs?: number } = {},
): Promise<MintTx[]> {
  const maxTx = opts.maxTx ?? 2000;
  // Public RPCs rate-limit per method; pace the per-transaction reads.
  const pause = () => new Promise((r) => setTimeout(r, opts.pauseMs ?? 0));
  const sigs: { signature: string; blockTime?: number | null; err: unknown }[] = [];
  let before: string | undefined;
  while (sigs.length < maxTx) {
    const page = await conn.getSignaturesForAddress(mint, { before, until: untilSignature, limit: 1000 }, "confirmed");
    sigs.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1]!.signature;
  }
  const out: MintTx[] = [];
  for (const s of sigs.reverse()) {
    if (s.err) { out.push({ signature: s.signature, at: (s.blockTime ?? 0) * 1000, deltas: [] }); continue; }
    await pause();
    const tx = await conn.getParsedTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) throw new Error(`transaction ${s.signature} not found yet`);
    out.push({ signature: s.signature, at: (tx.blockTime ?? s.blockTime ?? 0) * 1000, deltas: mintDeltas(tx, mint.toBase58()) });
  }
  return out;
}

export async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    return BigInt((await conn.getTokenAccountBalance(ata(owner, mint))).value.amount);
  } catch {
    return 0n; // no token account yet
  }
}
