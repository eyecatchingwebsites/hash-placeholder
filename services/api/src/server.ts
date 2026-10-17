import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { KeyObject } from "node:crypto";
import {
  assignGpu, isRigId, isSolanaAddress, rawPublicKey, signPayload, vendorOf,
  type CoinInfo, type GpuReport, type GpuSwitchState, type RevenueQuote, type ScoreInputs, type SignedEnvelope, type SwitchPolicy,
} from "@hashcoin/switcher";
import { clientIp, DEFAULT_LIMITS, RateLimiter, type RateLimits } from "./guard.js";
import { normalizeContact, normalizeGpu, type Waitlist } from "./waitlist.js";

export interface ApiDeps {
  coins: CoinInfo[];
  quotes: RevenueQuote[];
  policy: SwitchPolicy;
  score: Omit<ScoreInputs, "platformSellUsdPerDay">;
  /** Live platform sell volume per coin (USD/day), for slippage scoring. */
  platformSell: () => Record<string, number>;
  ttlMs: number;
  minerManifest: unknown;
  signingKey: KeyObject;
  kid: string;
  now?: () => number;
  /** Called for every assignment handed out, so the collector can map pool workers back to wallets. */
  onAssign?: (w: WorkerRecord) => void;
  /** The payout loop's public record (services/payouts data/public.json), or null before the first round. */
  publicRecord?: () => { wallets?: Record<string, unknown>; priceUsd?: number } | null;
  /** Price history for the app's charts (PRL from the pool; $HASH once it trades). */
  prices?: () => Promise<unknown>;
  /** The desktop app's update feed (Tauri's static update manifest, written by the release
   *  workflow as latest.json), or null when there's no release to offer. */
  appUpdate?: () => unknown | null;
  /** Website waitlist (POST /v1/waitlist). Without one, the endpoint answers 503. */
  waitlist?: Waitlist;
  /** Origins allowed to POST to the waitlist from a browser (the website). */
  siteOrigins?: string[];
  /** Per-IP and per-wallet request limits (DEFAULT_LIMITS if not set). */
  limits?: RateLimits;
}

/** One pool worker (one GPU) and the wallet it pays. */
export interface WorkerRecord {
  /** Worker name on the pool, after the payout address: `<workerId>-<gpuIndex>`. */
  worker: string;
  coin: string;
  wallet: string;
  rigId: string;
  gpuIndex: number;
  gpu: string;
  at: number;
}

const MAX_BODY = 64 * 1024;
/** Switch state for a GPU not heard from in this long is dropped (it starts fresh if it returns). */
const STATE_IDLE_MS = 24 * 3_600_000;
const MAX_GPUS = 16;

class HttpError extends Error { constructor(public status: number, msg: string, public retryAfter?: number) { super(msg); } }

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) throw new HttpError(413, "body too large");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "invalid JSON"); }
}

function parseGpus(raw: unknown): GpuReport[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_GPUS) throw new HttpError(400, `gpus must be 1-${MAX_GPUS} entries`);
  return raw.map((g, i) => {
    const o = g as Record<string, unknown>;
    if (typeof o.name !== "string" || o.name.length > 100) throw new HttpError(400, `gpus[${i}].name invalid`);
    const index = Number.isInteger(o.index) ? (o.index as number) : i;
    const vendor = vendorOf(o.name);
    if (!vendor) throw new HttpError(400, `gpus[${i}]: unsupported GPU "${o.name}"`);
    const benchmarks = Array.isArray(o.benchmarks)
      ? o.benchmarks.slice(0, 20).flatMap((b) => {
        const x = b as Record<string, unknown>;
        return typeof x.coin === "string" && typeof x.usdPerDay === "number" && x.usdPerDay >= 0 && x.usdPerDay < 1000
          ? [{ coin: x.coin, usdPerDay: x.usdPerDay }] : [];
      })
      : undefined;
    return { index, name: o.name, vendor, benchmarks };
  });
}

export function createApi(deps: ApiDeps): { server: Server; state: Map<string, GpuSwitchState> } {
  const state = new Map<string, GpuSwitchState>();
  const lastSeen = new Map<string, number>();
  const now = deps.now ?? Date.now;
  const manifestEnv = signPayload(deps.minerManifest, deps.signingKey, deps.kid);
  const lim = deps.limits ?? DEFAULT_LIMITS;
  const mk = (l: { limit: number; windowMs: number }) => new RateLimiter(l.limit, l.windowMs, now);
  const perIp = mk(lim.perIp), assignPerIp = mk(lim.assignPerIp), assignPerWallet = mk(lim.assignPerWallet), waitlistPerIp = mk(lim.waitlistPerIp);
  const origins = new Set(deps.siteOrigins ?? []);
  let pruneAt = 0;
  const limited = (wait: number) => { if (wait) throw new HttpError(429, `too many requests; try again in ${wait} s`, wait); };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };

    const ip = clientIp(req);
    limited(perIp.take(ip));

    if (req.method === "GET" && url.pathname === "/v1/health") return send(200, { ok: true });

    // Website waitlist. Browsers may only post from the site's own origins.
    if (url.pathname === "/v1/waitlist") {
      const origin = req.headers.origin;
      if (typeof origin === "string" && origins.has(origin)) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "origin");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" });
        return res.end();
      }
      if (!deps.waitlist) return send(503, { error: "the waitlist isn't open" });
      if (req.method === "GET") return send(200, { count: deps.waitlist.count() });
      if (req.method === "POST") {
        if (typeof origin === "string" && !origins.has(origin)) throw new HttpError(403, "origin not allowed");
        limited(waitlistPerIp.take(ip));
        const body = (await readJson(req)) as Record<string, unknown>;
        const contact = normalizeContact(body?.contact);
        if (!contact) throw new HttpError(400, "enter an X handle or an email address");
        const r = deps.waitlist.add({ contact, gpu: normalizeGpu(body.gpu) });
        if (r === "full") throw new HttpError(503, "the waitlist is full");
        return send(200, { ok: true, already: r === "exists", count: deps.waitlist.count() });
      }
    }
    if (req.method === "GET" && url.pathname === "/v1/prices") {
      res.setHeader("access-control-allow-origin", "*");
      return deps.prices ? send(200, await deps.prices()) : send(503, { error: "no price feed" });
    }
    // Public payout record, readable from the website.
    if (req.method === "GET" && (url.pathname === "/v1/stats" || url.pathname.startsWith("/v1/wallet/"))) {
      res.setHeader("access-control-allow-origin", "*");
      const rec = deps.publicRecord?.();
      if (!rec) return send(503, { error: "no payout rounds yet" });
      if (url.pathname === "/v1/stats") { const { wallets, ...stats } = rec; return send(200, { ...stats, wallets: Object.keys(wallets ?? {}).length }); }
      const address = decodeURIComponent(url.pathname.slice("/v1/wallet/".length));
      if (!isSolanaAddress(address)) return send(400, { error: "not a Solana address" });
      const w = rec.wallets?.[address];
      return w ? send(200, { address, priceUsd: rec.priceUsd, ...(w as object) }) : send(404, { error: "no $HASH activity for this wallet yet" });
    }
    // Desktop app updates: /v1/app/update/<target>/<arch>/<current version>. The app compares versions
    // and checks the installer's signature against the update key built into it, so this only
    // serves what the release workflow signed. 204 = nothing to offer.
    if (req.method === "GET" && url.pathname.startsWith("/v1/app/update/")) {
      const feed = deps.appUpdate?.();
      if (!feed) { res.writeHead(204, { "cache-control": "no-store" }); return res.end(); }
      return send(200, feed);
    }
    if (req.method === "GET" && url.pathname === "/v1/keys") return send(200, { [deps.kid]: rawPublicKey(deps.signingKey) });
    if (req.method === "GET" && url.pathname === "/v1/miners") return send(200, manifestEnv);

    if (req.method === "POST" && url.pathname === "/v1/assignments") {
      limited(assignPerIp.take(ip));
      const body = (await readJson(req)) as Record<string, unknown>;
      const wallet = String(body?.wallet ?? "");
      const rigId = String(body?.rigId ?? "");
      if (!isSolanaAddress(wallet)) throw new HttpError(400, "wallet must be a Solana address");
      limited(assignPerWallet.take(wallet));
      if (!isRigId(rigId)) throw new HttpError(400, "rigId must be 1-24 letters, digits, - or _");
      const gpus = parseGpus(body.gpus);
      const region = typeof body.region === "string" ? body.region : undefined;
      const t = now();
      if (t >= pruneAt) {
        pruneAt = t + 600_000;
        for (const [k, seen] of lastSeen) if (t - seen > STATE_IDLE_MS) { lastSeen.delete(k); state.delete(k); }
      }
      const ctx = {
        coins: deps.coins, quotes: deps.quotes, policy: deps.policy, ttlMs: deps.ttlMs, region,
        score: { ...deps.score, platformSellUsdPerDay: deps.platformSell() },
      };
      const results: { gpuIndex: number; assignment: SignedEnvelope | null; reason: string }[] = [];
      for (const g of gpus) {
        const key = `${wallet}:${rigId}:${g.index}`;
        const r = assignGpu({ wallet, rigId }, g, state.get(key) ?? null, t, ctx);
        state.set(key, r.state);
        lastSeen.set(key, t);
        if (r.assignment) {
          const worker = r.assignment.pool.user.slice(r.assignment.pool.user.lastIndexOf(".") + 1);
          deps.onAssign?.({ worker, coin: r.assignment.coin, wallet, rigId, gpuIndex: g.index, gpu: g.name, at: t });
        }
        results.push({ gpuIndex: g.index, reason: r.reason, assignment: r.assignment ? signPayload(r.assignment, deps.signingKey, deps.kid) : null });
      }
      return send(200, { serverTime: t, results });
    }
    send(404, { error: "not found" });
  }

  const server = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
      if (e instanceof HttpError && e.retryAfter) headers["retry-after"] = String(e.retryAfter);
      // Close the connection after an oversized body instead of reading the rest of it.
      if (status === 413) headers.connection = "close";
      if (res.headersSent) return res.end();
      res.writeHead(status, headers);
      res.end(JSON.stringify({ error: status === 500 ? "internal error" : (e as Error).message }));
    });
  });
  // Slow or stuck clients can't hold connections open.
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  return { server, state };
}
