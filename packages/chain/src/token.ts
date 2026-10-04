// On-chain actions for $HASH: a Token-2022 mint with the transfer-fee extension, fee harvesting,
// and batched payouts. Devnet first (packages/chain/scripts/devnet-run.ts).
import {
  type Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction,
  type TransactionSignature,
} from "@solana/web3.js";
import {
  AuthorityType, createAssociatedTokenAccountIdempotentInstruction, createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction, createMintToInstruction, createSetAuthorityInstruction,
  createTransferCheckedWithFeeInstruction, ExtensionType, getAssociatedTokenAddressSync, getMintLen,
  getTransferFeeAmount, harvestWithheldTokensToMint, TOKEN_2022_PROGRAM_ID, unpackAccount,
  withdrawWithheldTokensFromMint,
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

/** Token accounts for this mint that hold withheld fees. */
export async function accountsWithWithheldFees(conn: Connection, mint: PublicKey): Promise<{ address: PublicKey; withheld: bigint }[]> {
  const accounts = await conn.getProgramAccounts(P, { filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] });
  return accounts.flatMap(({ pubkey, account }) => {
    const parsed = unpackAccount(pubkey, account, P);
    const withheld = getTransferFeeAmount(parsed)?.withheldAmount ?? 0n;
    return withheld > 0n ? [{ address: pubkey, withheld }] : [];
  });
}

/**
 * Collect the tax: move withheld fees from token accounts into the mint (anyone may), then the
 * withdraw authority moves them from the mint to the treasury's token account.
 */
export async function harvestFees(conn: Connection, payer: Keypair, mint: PublicKey, withdrawAuthority: Keypair, treasury: PublicKey): Promise<{ harvested: bigint; signatures: TransactionSignature[] }> {
  const sources = await accountsWithWithheldFees(conn, mint);
  const signatures: TransactionSignature[] = [];
  for (const group of chunk(sources.map((s) => s.address), 20)) {
    signatures.push(await harvestWithheldTokensToMint(conn, payer, mint, group, undefined, P));
  }
  const dest = ata(treasury, mint);
  const before = (await conn.getTokenAccountBalance(dest)).value.amount;
  signatures.push(await withdrawWithheldTokensFromMint(conn, payer, mint, dest, withdrawAuthority, [], undefined, P));
  const after = (await conn.getTokenAccountBalance(dest)).value.amount;
  return { harvested: BigInt(after) - BigInt(before), signatures };
}

export async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    return BigInt((await conn.getTokenAccountBalance(ata(owner, mint))).value.amount);
  } catch {
    return 0n; // no token account yet
  }
}
