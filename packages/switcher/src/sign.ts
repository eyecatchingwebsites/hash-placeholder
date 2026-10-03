import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import type { SignedEnvelope } from "./types.js";

/** JSON with object keys sorted, so the same data always produces the same bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

export function signPayload(value: unknown, key: KeyObject, kid: string): SignedEnvelope {
  const payload = canonicalJson(value);
  return { kid, payload, sig: sign(null, Buffer.from(payload, "utf8"), key).toString("base64") };
}

export function verifyEnvelope<T>(env: SignedEnvelope, keys: Record<string, KeyObject>): T {
  const key = keys[env.kid];
  if (!key) throw new Error(`unknown key id ${env.kid}`);
  if (!verify(null, Buffer.from(env.payload, "utf8"), key, Buffer.from(env.sig, "base64"))) throw new Error("bad signature");
  return JSON.parse(env.payload) as T;
}

/** Raw 32-byte Ed25519 public key (base64), the form the desktop app embeds. */
export function rawPublicKey(key: KeyObject): string {
  const der = createPublicKey(key).export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("base64");
}

export function newSigningKey(): { privatePem: string; publicRawB64: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(), publicRawB64: rawPublicKey(privateKey) };
}

export function loadSigningKey(pem: string): KeyObject {
  return createPrivateKey(pem);
}
