// One choke point for everything that goes on-chain. Every send (our helpers, spl-token's,
// Meteora's builders via sendAndConfirmTransaction) ends in `connection.sendRawTransaction`, so
// the kill switch and dry-run mode are enforced there: no code path can sign around them.
import { Connection, type ConnectionConfig } from "@solana/web3.js";

export class SendBlockedError extends Error {
  constructor(reason: string) {
    super(`send blocked: ${reason}`);
    this.name = "SendBlockedError";
  }
}

/**
 * Refuse every transaction send on `conn` while `blocked()` returns a reason (kill switch engaged,
 * dry run). Checked at each send, so engaging the kill switch stops a round mid-way.
 */
export function guardSends(conn: Connection, blocked: () => string | null): Connection {
  const raw = conn.sendRawTransaction.bind(conn);
  const encoded = conn.sendEncodedTransaction.bind(conn);
  conn.sendRawTransaction = (...args: Parameters<Connection["sendRawTransaction"]>) => {
    const why = blocked();
    return why ? Promise.reject(new SendBlockedError(why)) : raw(...args);
  };
  conn.sendEncodedTransaction = (...args: Parameters<Connection["sendEncodedTransaction"]>) => {
    const why = blocked();
    return why ? Promise.reject(new SendBlockedError(why)) : encoded(...args);
  };
  return conn;
}

export interface RpcError { at: number; method: string; error: string }

/**
 * A connection that reports every failed RPC call (HTTP error, rate limit, network failure) to
 * `onError`, for alerting. web3.js retries 429s itself; each retry is reported.
 */
export function monitoredConnection(url: string, onError: (e: RpcError) => void, config: ConnectionConfig = { commitment: "confirmed" }): Connection {
  const fetchFn: typeof fetch = async (input, init) => {
    let method = "?";
    try { method = (JSON.parse(String(init?.body ?? "{}")) as { method?: string }).method ?? "?"; } catch { /* batch or non-JSON body */ }
    try {
      const res = await fetch(input, init);
      if (!res.ok) onError({ at: Date.now(), method, error: `HTTP ${res.status}` });
      return res;
    } catch (e) {
      onError({ at: Date.now(), method, error: (e as Error).message });
      throw e;
    }
  };
  return new Connection(url, { ...config, fetch: fetchFn });
}
