import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A Solana address is base58 for exactly 32 bytes. Public addresses only, never keys. */
export function isSolanaAddress(s: string): boolean {
  if (s.length < 32 || s.length > 44) return false;
  return base58Decode(s)?.length === 32;
}

/** Rig ids feed into the pool worker name, so keep them short and safe. */
export function isRigId(s: string): boolean {
  return /^[A-Za-z0-9_-]{1,24}$/.test(s);
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Short pool worker id for a wallet's rig: "h" + the first 10 base32 characters of
 * SHA-256("wallet:rigId"). The app computes the same id, so it can check an assignment is its own
 * without the 44-character Solana address in the pool login (pools limit worker names, and the
 * login would otherwise publish the wallet on the pool's pages). The server keeps the reverse map.
 */
export function workerId(wallet: string, rigId: string): string {
  const hash = createHash("sha256").update(`${wallet}:${rigId}`).digest();
  let out = "h", value = 0, bits = 0;
  for (const byte of hash) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5 && out.length < 11) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= 11) break;
  }
  return out;
}

/** Pool login: the platform's payout address for the coin, then this GPU's worker name. */
export function poolUser(payoutAddress: string, wallet: string, rigId: string, gpuIndex: number): string {
  return `${payoutAddress}.${workerId(wallet, rigId)}-${gpuIndex}`;
}
