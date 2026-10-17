import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { loadSigningKey, newSigningKey, verifyEnvelope, workerId, type Assignment, type SignedEnvelope } from "@hashcoin/switcher";
import { createApi, type WorkerRecord } from "../src/server.js";
import { loadHashrateNoQuotes } from "../src/quotes.js";

const cfg = JSON.parse(readFileSync(new URL("../config/coins.json", import.meta.url), "utf8"));
const quotes = loadHashrateNoQuotes(fileURLToPath(new URL("../../../data/hashrate-no-gpus-2026-10-03.json", import.meta.url)));
const key = loadSigningKey(newSigningKey().privatePem);
const WALLET = "4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF";
let clock = 1_800_000_000_000;
const recorded: WorkerRecord[] = [];
let appFeed: unknown = null;
const PRL_PAYOUT = cfg.coins.find((c: { id: string }) => c.id === "PRL").payoutAddress as string;
const api = createApi({
  coins: cfg.coins, quotes, policy: cfg.policy, score: cfg.score, ttlMs: cfg.ttlMs, platformSell: () => ({}),
  minerManifest: { version: 1, miners: [] }, signingKey: key, kid: "t1", now: () => clock,
  onAssign: (w) => recorded.push(w),
  publicRecord: () => ({ round: 3, wallets: { [WALLET]: { holderLevel: 2 } } }),
  appUpdate: () => appFeed,
});
let base = "";
beforeAll(async () => { await new Promise<void>((r) => api.server.listen(0, r)); base = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`; });
afterAll(() => api.server.close());

const post = (body: unknown) => fetch(`${base}/v1/assignments`, { method: "POST", body: JSON.stringify(body) });
const pub = { t1: createPublicKey(key) };

describe("api", () => {
  it("assigns PRL to an RTX 4070, signed; an AMD card waits for a miner", async () => {
    const res = await post({ wallet: WALLET, rigId: "gamingpc", gpus: [{ index: 0, name: "NVIDIA GeForce RTX 4070" }, { index: 1, name: "AMD Radeon RX 7900 XTX" }] });
    expect(res.status).toBe(200);
    const body = await res.json() as { results: { assignment: SignedEnvelope | null }[] };
    const a = verifyEnvelope<Assignment>(body.results[0]!.assignment!, pub);
    expect(a).toMatchObject({ coin: "PRL", algo: "pearlhash", minerId: "forgeminer", pool: { user: `${PRL_PAYOUT}.${workerId(WALLET, "gamingpc")}-0` } });
    // The collector maps the pool worker back to the wallet through this record.
    expect(recorded).toEqual([expect.objectContaining({ worker: `${workerId(WALLET, "gamingpc")}-0`, coin: "PRL", wallet: WALLET, rigId: "gamingpc", gpuIndex: 0 })]);
    // No AMD miner yet that Windows Defender doesn't flag (see services/api/config/coins.json).
    expect(body.results[1]!.assignment).toBeNull();
    expect(a!.expiresAt - a!.issuedAt).toBe(cfg.ttlMs);
  });

  it("keeps the coin across check-ins (hysteresis state)", async () => {
    clock += 60_000;
    const res = await post({ wallet: WALLET, rigId: "gamingpc", gpus: [{ index: 0, name: "NVIDIA GeForce RTX 4070", benchmarks: [{ coin: "QTC", usdPerDay: 4 }] }] });
    const r = (await res.json() as { results: { reason: string; assignment: SignedEnvelope }[] }).results[0]!;
    expect(verifyEnvelope<Assignment>(r.assignment, pub).coin).toBe("PRL");
    // QTC has no platform payout address yet, so it is never offered even with a better benchmark.
    expect(r.reason).toMatch(/stay on PRL/);
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
  it("serves the public payout record: stats and one wallet", async () => {
    const stats = await (await fetch(`${base}/v1/stats`)).json();
    expect(stats).toEqual({ round: 3, wallets: 1 });
    const w = await fetch(`${base}/v1/wallet/${WALLET}`);
    expect(w.headers.get("access-control-allow-origin")).toBe("*");
    expect(await w.json()).toEqual({ address: WALLET, holderLevel: 2 });
    expect((await fetch(`${base}/v1/wallet/not-an-address`)).status).toBe(400);
    expect((await fetch(`${base}/v1/wallet/11111111111111111111111111111111`)).status).toBe(404);
  });
  it("serves the desktop update feed, or 204 when there's no release", async () => {
    const url = `${base}/v1/app/update/windows-x86_64/x86_64/0.1.0`;
    expect((await fetch(url)).status).toBe(204);
    appFeed = { version: "0.1.1", platforms: { "windows-x86_64": { signature: "sig", url: "https://example.com/setup.exe" } } };
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(appFeed);
  });
});

describe("api limits and waitlist", () => {
  let t = 1_800_000_000_000;
  const entries: { contact: string; gpu: string | null }[] = [];
  const small = createApi({
    coins: cfg.coins, quotes, policy: cfg.policy, score: cfg.score, ttlMs: cfg.ttlMs, platformSell: () => ({}),
    minerManifest: { version: 1, miners: [] }, signingKey: key, kid: "t1", now: () => t,
    siteOrigins: ["https://hashcoin.app"],
    waitlist: {
      add: (e) => entries.some((x) => x.contact === e.contact) ? "exists" : (entries.push(e), "added"),
      count: () => entries.length,
    },
    limits: {
      perIp: { limit: 1000, windowMs: 60_000 },
      assignPerIp: { limit: 1000, windowMs: 60_000 },
      assignPerWallet: { limit: 2, windowMs: 60_000 },
      waitlistPerIp: { limit: 3, windowMs: 600_000 },
    },
  });
  let b = "";
  beforeAll(async () => { await new Promise<void>((r) => small.server.listen(0, "127.0.0.1", r)); b = `http://127.0.0.1:${(small.server.address() as AddressInfo).port}`; });
  afterAll(() => small.server.close());
  const join = (body: unknown, ip = "203.0.113.7", origin = "https://hashcoin.app") => fetch(`${b}/v1/waitlist`, {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin, "cf-connecting-ip": ip },
  });

  it("adds a waitlist entry from the site's origin, once per contact", async () => {
    const pre = await fetch(`${b}/v1/waitlist`, { method: "OPTIONS", headers: { origin: "https://hashcoin.app" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://hashcoin.app");
    const r = await join({ contact: "@Some_Trader", gpu: "NVIDIA GeForce RTX 4070" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, already: false, count: 1 });
    expect(entries[0]).toEqual({ contact: "@some_trader", gpu: "NVIDIA GeForce RTX 4070" });
    expect(await (await join({ contact: "some_trader" })).json()).toMatchObject({ already: true, count: 1 });
    expect((await join({ contact: "not an email or handle" })).status).toBe(400);
    expect((await join({ contact: "a@b.co" }, "203.0.113.7", "https://evil.example")).status).toBe(403);
    expect(await (await fetch(`${b}/v1/waitlist`)).json()).toEqual({ count: 1 });
  });

  it("rate-limits waitlist posts per visitor IP (CF-Connecting-IP behind the tunnel)", async () => {
    // 203.0.113.7 already used 3 (the 403 is refused before the limit is counted).
    const r = await join({ contact: "x@example.com" });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await join({ contact: "x@example.com" }, "198.51.100.2")).status).toBe(200);
    t += 600_000;
    expect((await join({ contact: "y@example.com" })).status).toBe(200);
  });

  it("rate-limits check-ins per wallet", async () => {
    const body = JSON.stringify({ wallet: WALLET, rigId: "pc", gpus: [{ name: "NVIDIA GeForce RTX 4070" }] });
    const go = () => fetch(`${b}/v1/assignments`, { method: "POST", body });
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(429);
  });

  it("refuses oversized bodies", async () => {
    const r = await fetch(`${b}/v1/assignments`, { method: "POST", body: "x".repeat(70 * 1024) });
    expect(r.status).toBe(413);
  });
});
