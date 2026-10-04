import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { loadSigningKey, newSigningKey, verifyEnvelope, type Assignment, type SignedEnvelope } from "@hashcoin/switcher";
import { createApi } from "../src/server.js";
import { loadHashrateNoQuotes } from "../src/quotes.js";

const cfg = JSON.parse(readFileSync(new URL("../config/coins.json", import.meta.url), "utf8"));
const quotes = loadHashrateNoQuotes(fileURLToPath(new URL("../../../data/hashrate-no-gpus-2026-10-03.json", import.meta.url)));
const key = loadSigningKey(newSigningKey().privatePem);
const WALLET = "4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF";
let clock = 1_800_000_000_000;
const api = createApi({
  coins: cfg.coins, quotes, policy: cfg.policy, score: cfg.score, ttlMs: cfg.ttlMs, platformSell: () => ({}),
  minerManifest: { version: 1, miners: [] }, signingKey: key, kid: "t1", now: () => clock,
});
let base = "";
beforeAll(async () => { await new Promise<void>((r) => api.server.listen(0, r)); base = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`; });
afterAll(() => api.server.close());

const post = (body: unknown) => fetch(`${base}/v1/assignments`, { method: "POST", body: JSON.stringify(body) });
const pub = { t1: createPublicKey(key) };

describe("api", () => {
  it("assigns PRL to an RTX 4070 and QTC to an RX 7900 XTX, signed", async () => {
    const res = await post({ wallet: WALLET, rigId: "gamingpc", gpus: [{ index: 0, name: "NVIDIA GeForce RTX 4070" }, { index: 1, name: "AMD Radeon RX 7900 XTX" }] });
    expect(res.status).toBe(200);
    const body = await res.json() as { results: { assignment: SignedEnvelope }[] };
    const [a, b] = body.results.map((r) => verifyEnvelope<Assignment>(r.assignment, pub));
    expect(a).toMatchObject({ coin: "PRL", minerId: "prl-miner", pool: { user: `${WALLET}.gamingpc-0` } });
    expect(b).toMatchObject({ coin: "QTC", minerId: "multi-miner" });
    expect(a!.expiresAt - a!.issuedAt).toBe(cfg.ttlMs);
  });

  it("keeps the coin across check-ins (hysteresis state)", async () => {
    clock += 60_000;
    const res = await post({ wallet: WALLET, rigId: "gamingpc", gpus: [{ index: 0, name: "NVIDIA GeForce RTX 4070", benchmarks: [{ coin: "QTC", usdPerDay: 4 }] }] });
    const r = (await res.json() as { results: { reason: string; assignment: SignedEnvelope }[] }).results[0]!;
    expect(verifyEnvelope<Assignment>(r.assignment, pub).coin).toBe("PRL");
    expect(r.reason).toMatch(/waiting/);
  });

  it("rejects bad input", async () => {
    expect((await post({ wallet: "nope", rigId: "x", gpus: [{ name: "RTX 4070" }] })).status).toBe(400);
    expect((await post({ wallet: WALLET, rigId: "bad id!", gpus: [{ name: "RTX 4070" }] })).status).toBe(400);
    expect((await post({ wallet: WALLET, rigId: "x", gpus: [{ name: "Matrox G200" }] })).status).toBe(400);
    expect((await fetch(`${base}/v1/assignments`, { method: "POST", body: "{" })).status).toBe(400);
  });

  it("serves the signed miner manifest and public key", async () => {
    const env = await (await fetch(`${base}/v1/miners`)).json() as SignedEnvelope;
    expect(verifyEnvelope(env, pub)).toEqual({ miners: [], version: 1 });
    const keys = await (await fetch(`${base}/v1/keys`)).json() as Record<string, string>;
    expect(Buffer.from(keys.t1!, "base64")).toHaveLength(32);
  });
});
