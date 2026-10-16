// Alerts: things a person should look at. Each goes to the console, to data/alerts.log, and to
// HASH_ALERT_WEBHOOK if set (a Discord or Slack incoming webhook: the JSON carries both `content`
// and `text`). The same alert repeats at most every `repeatMs` while it lasts; `resolve` clears it.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import type { RpcError } from "@hashcoin/chain";

export type AlertLevel = "critical" | "warning" | "info";

export interface Alert { key: string; level: AlertLevel; message: string; at: number }

export interface AlertSink {
  webhook?: string;
  logFile?: string;
  /** Where the repeat timers are kept, so a restart doesn't re-send every alert at once. */
  stateFile?: string;
  repeatMs: number;
  /** Prefix on every message (network, so a devnet alert is never mistaken for mainnet). */
  label: string;
  post?: (url: string, body: unknown) => Promise<void>;
  now?: () => number;
  print?: (line: string) => void;
}

const defaultPost = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
};

export class Alerts {
  private last = new Map<string, number>();
  readonly sent: Alert[] = [];
  constructor(private sink: AlertSink) {
    if (sink.stateFile) {
      try { this.last = new Map(Object.entries(JSON.parse(readFileSync(sink.stateFile, "utf8")) as Record<string, number>)); } catch { /* first run */ }
    }
  }

  private persist() {
    if (!this.sink.stateFile) return;
    try { writeFileSync(this.sink.stateFile, JSON.stringify(Object.fromEntries(this.last))); } catch { /* repeats are a nuisance, not a failure */ }
  }

  /** Raise an alert; returns whether it went out (false while a repeat is suppressed). */
  async raise(key: string, level: AlertLevel, message: string): Promise<boolean> {
    const now = (this.sink.now ?? Date.now)();
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.sink.repeatMs) return false;
    this.last.set(key, now);
    this.persist();
    const a: Alert = { key, level, message, at: now };
    this.sent.push(a);
    const line = `${new Date(now).toISOString()} [${level}] ${this.sink.label} ${key}: ${message}`;
    (this.sink.print ?? console.log)(`ALERT ${line}`);
    if (this.sink.logFile) { try { appendFileSync(this.sink.logFile, `${line}\n`); } catch { /* the console has it */ } }
    if (this.sink.webhook) {
      const icon = level === "critical" ? "🔴" : level === "warning" ? "🟠" : "🔵";
      const text = `${icon} **${this.sink.label}** ${key}: ${message}`;
      try { await (this.sink.post ?? defaultPost)(this.sink.webhook, { content: text, text, level, key }); }
      catch (e) { (this.sink.print ?? console.log)(`alert webhook failed: ${(e as Error).message}`); }
    }
    return true;
  }

  /** The condition is over: the next occurrence alerts straight away. */
  resolve(key: string) {
    if (this.last.delete(key)) this.persist();
  }
}

/** Failed RPC calls in a sliding window. */
export class RpcWatch {
  private errors: RpcError[] = [];
  constructor(private windowMs = 10 * 60_000) {}
  record = (e: RpcError) => {
    this.errors.push(e);
    if (this.errors.length > 1000) this.errors = this.errors.slice(-500);
  };
  recent(now = Date.now()): RpcError[] {
    this.errors = this.errors.filter((e) => e.at > now - this.windowMs);
    return this.errors;
  }
  summary(now = Date.now()): string {
    const by = new Map<string, number>();
    for (const e of this.recent(now)) by.set(`${e.method} ${e.error}`, (by.get(`${e.method} ${e.error}`) ?? 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n}× ${k}`).join(", ");
  }
}
