// Kryptex pool's public API (no key): https://pool.kryptex.com/openapi.yaml

const BASE = "https://pool.kryptex.com";

/** One worker as `/{coin}/api/v3/miner/workers/{address}` returns it. Hashrates are strings in H/s. */
export interface KryptexWorker {
  worker: string;
  scheme: string;
  status: string;
  /** Session start (ms epoch). The pool's averages count the time before it as zero. */
  opened_at: number;
  last_share: number;
  valid: number;
  stale: number;
  invalid: number;
  avg_hashrate_30m: string;
  avg_hashrate_3h: string;
  agent?: string;
}

/** The parts of `/{coin}/api/v1/pool/info` the collector uses. */
export interface KryptexPoolInfo {
  net_hashrate: number;
  /** Coins per block. */
  block_reward: number;
  /** Seconds per block. */
  block_time: number;
  /** Pool fee for PPS+, e.g. 0.02. */
  fee: number;
}

async function getJson<T>(url: string, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Every worker under the platform's payout address, page by page. */
export async function fetchWorkers(coin: string, address: string, fetchFn: typeof fetch = fetch): Promise<KryptexWorker[]> {
  const all: KryptexWorker[] = [];
  for (let page = 1; page <= 1000; page++) {
    const body = await getJson<{ results?: KryptexWorker[] }>(`${BASE}/${coin}/api/v3/miner/workers/${address}?page=${page}`, fetchFn);
    const results = body.results ?? [];
    const fresh = results.filter((w) => !all.some((x) => x.worker === w.worker));
    if (fresh.length === 0) break; // empty page, or the API ignores paging and repeats page 1
    all.push(...fresh);
  }
  return all;
}

export function fetchPoolInfo(coin: string, fetchFn: typeof fetch = fetch): Promise<KryptexPoolInfo> {
  return getJson<KryptexPoolInfo>(`${BASE}/${coin}/api/v1/pool/info`, fetchFn);
}

/** Latest USD price from the pool's price chart. */
export async function fetchPriceUsd(coin: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const points = await getJson<{ timestamp: number; price: number }[]>(`${BASE}/api/v1/coin/${coin}/price/chart`, fetchFn);
  const last = points.at(-1);
  if (!last || !(last.price > 0)) throw new Error(`no ${coin} price`);
  return last.price;
}
