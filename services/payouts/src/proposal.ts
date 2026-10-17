// When the multisig holds the fee config authority, the loop doesn't change the rate itself: it
// writes the instruction for the multisig's signers to review and approve (Squads: "Add
// instruction" / transaction builder, with the vault as the authority), and alerts.
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createSetTransferFeeInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

export interface Proposal {
  what: string;
  reason: string;
  createdAt: string;
  /** The single instruction to propose, signed by the multisig vault. */
  instruction: { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; dataHex: string; dataBase64: string };
  howTo: string;
}

export function describeInstruction(ix: TransactionInstruction): Proposal["instruction"] {
  return {
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    dataHex: Buffer.from(ix.data).toString("hex"), dataBase64: Buffer.from(ix.data).toString("base64"),
  };
}

export function rateProposal(x: { mint: PublicKey; multisig: PublicKey; bps: number; maxFee: bigint; reason: string; now: number }): Proposal {
  const ix = createSetTransferFeeInstruction(x.mint, x.multisig, [], x.bps, x.maxFee, TOKEN_2022_PROGRAM_ID);
  return {
    what: `Set the $HASH tax to ${x.bps / 100}% (Token-2022 SetTransferFee on ${x.mint.toBase58()}; takes effect two epochs after it lands)`,
    reason: x.reason,
    createdAt: new Date(x.now).toISOString(),
    instruction: describeInstruction(ix),
    howTo: "Create a transaction in the multisig with this one instruction (the vault signs as the fee config authority), check the rate against the public formula, approve, execute.",
  };
}
