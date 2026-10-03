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

/** Rig ids become part of the pool worker name, so keep them short and safe. */
export function isRigId(s: string): boolean {
  return /^[A-Za-z0-9_-]{1,24}$/.test(s);
}
