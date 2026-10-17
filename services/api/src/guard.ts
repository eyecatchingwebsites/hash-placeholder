import type { IncomingMessage } from "node:http";

/** Fixed-window counter per key (an IP or a wallet). Old windows are dropped as time moves on,
 *  so memory stays bounded by the keys seen in the current window. */
export class RateLimiter {
  private hits = new Map<string, number>();
  private windowStart = 0;
  constructor(readonly limit: number, readonly windowMs: number, private now: () => number = Date.now) {}

  /** Counts one hit. Returns 0 if allowed, or the seconds until the window resets. */
  take(key: string): number {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) { this.hits.clear(); this.windowStart = t; }
    const n = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, n);
    return n <= this.limit ? 0 : Math.max(1, Math.ceil((this.windowStart + this.windowMs - t) / 1000));
  }
}

export interface RateLimits {
  /** Every request, per client IP. */
  perIp: { limit: number; windowMs: number };
  /** POST /v1/assignments per client IP (the app checks in every 5 minutes per PC; many PCs can share an IP). */
  assignPerIp: { limit: number; windowMs: number };
  /** POST /v1/assignments per wallet. */
  assignPerWallet: { limit: number; windowMs: number };
  /** POST /v1/waitlist per client IP. */
  waitlistPerIp: { limit: number; windowMs: number };
}

export const DEFAULT_LIMITS: RateLimits = {
  perIp: { limit: 300, windowMs: 60_000 },
  assignPerIp: { limit: 60, windowMs: 60_000 },
  assignPerWallet: { limit: 20, windowMs: 60_000 },
  waitlistPerIp: { limit: 5, windowMs: 10 * 60_000 },
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The visitor's IP. Behind the Cloudflare Tunnel every connection comes from cloudflared on this
 *  PC, so the real IP is the CF-Connecting-IP header. That header is only trusted on a loopback
 *  connection; a direct connection from anywhere else is judged by its own address. */
export function clientIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? "unknown";
  const cf = req.headers["cf-connecting-ip"];
  if (LOOPBACK.has(peer) && typeof cf === "string" && cf.length > 0 && cf.length <= 64) return cf;
  return peer;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
