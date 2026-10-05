import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { KeyObject } from "node:crypto";
import {
  assignGpu, isRigId, isSolanaAddress, rawPublicKey, signPayload, vendorOf,
  type CoinInfo, type GpuReport, type GpuSwitchState, type RevenueQuote, type ScoreInputs, type SignedEnvelope, type SwitchPolicy,
} from "@hashcoin/switcher";

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
  publicRecord?: () => { wallets?: Record<string, unknown> } | null;
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
const MAX_GPUS = 16;

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function readJson(req: IncomingMessage): Promise<unknown> {
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
  const now = deps.now ?? Date.now;
  const manifestEnv = signPayload(deps.minerManifest, deps.signingKey, deps.kid);

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && url.pathname === "/v1/health") return send(200, { ok: true });
    // Public payout record, readable from the website.
    if (req.method === "GET" && (url.pathname === "/v1/stats" || url.pathname.startsWith("/v1/wallet/"))) {
      res.setHeader("access-control-allow-origin", "*");
      const rec = deps.publicRecord?.();
      if (!rec) return send(503, { error: "no payout rounds yet" });
      if (url.pathname === "/v1/stats") { const { wallets, ...stats } = rec; return send(200, { ...stats, wallets: Object.keys(wallets ?? {}).length }); }
      const address = decodeURIComponent(url.pathname.slice("/v1/wallet/".length));
      if (!isSolanaAddress(address)) return send(400, { error: "not a Solana address" });
      const w = rec.wallets?.[address];
      return w ? send(200, { address, ...(w as object) }) : send(404, { error: "no $HASH activity for this wallet yet" });
    }
    if (req.method === "GET" && url.pathname === "/v1/keys") return send(200, { [deps.kid]: rawPublicKey(deps.signingKey) });
    if (req.method === "GET" && url.pathname === "/v1/miners") return send(200, manifestEnv);

    if (req.method === "POST" && url.pathname === "/v1/assignments") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const wallet = String(body.wallet ?? "");
      const rigId = String(body.rigId ?? "");
      if (!isSolanaAddress(wallet)) throw new HttpError(400, "wallet must be a Solana address");
      if (!isRigId(rigId)) throw new HttpError(400, "rigId must be 1-24 letters, digits, - or _");
      const gpus = parseGpus(body.gpus);
      const region = typeof body.region === "string" ? body.region : undefined;
      const t = now();
      const ctx = {
        coins: deps.coins, quotes: deps.quotes, policy: deps.policy, ttlMs: deps.ttlMs, region,
        score: { ...deps.score, platformSellUsdPerDay: deps.platformSell() },
      };
      const results: { gpuIndex: number; assignment: SignedEnvelope | null; reason: string }[] = [];
      for (const g of gpus) {
        const key = `${wallet}:${rigId}:${g.index}`;
        const r = assignGpu({ wallet, rigId }, g, state.get(key) ?? null, t, ctx);
        state.set(key, r.state);
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

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: status === 500 ? "internal error" : (e as Error).message }));
    });
  });
  return { server, state };
}
