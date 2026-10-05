import { describe, expect, it } from "vitest";
import { Keypair, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { mintDeltas } from "../src/token.js";

const MINT = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
const keys = [0, 1, 2].map(() => ({ pubkey: Keypair.generate().publicKey }));
const bal = (accountIndex: number, owner: string, amount: string, mint = MINT) => ({ accountIndex, mint, owner, uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: "" } });
const tx = (pre: unknown[], post: unknown[], err: unknown = null) =>
  ({ meta: { err, preTokenBalances: pre, postTokenBalances: post }, transaction: { message: { accountKeys: keys } } }) as unknown as ParsedTransactionWithMeta;

describe("mintDeltas", () => {
  it("reads each account's change for the mint, including a newly created recipient account", () => {
    const d = mintDeltas(tx([bal(0, "A", "1000"), bal(2, "C", "5", OTHER)], [bal(0, "A", "900"), bal(1, "B", "95"), bal(2, "C", "9", OTHER)]), MINT);
    expect(d).toEqual([
      { owner: "A", account: keys[0]!.pubkey.toBase58(), delta: -100n },
      { owner: "B", account: keys[1]!.pubkey.toBase58(), delta: 95n },
    ]);
  });
  it("ignores failed transactions", () => {
    expect(mintDeltas(tx([bal(0, "A", "1000")], [bal(0, "A", "0")], { InstructionError: [0, "x"] }), MINT)).toEqual([]);
  });
});
