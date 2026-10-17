import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { DEFAULT_RULES, HOUR_MS, type PriceContext } from "@hashcoin/engine";
import { guardSends, lamportsForUsd, SendBlockedError, sqrtPriceToPrice, type MintTx } from "@hashcoin/chain";
import { Alerts, RpcWatch } from "../src/alerts.js";
import { checkRuntime, type PayoutsConfig } from "../src/config.js";
import { engageKill, killReason, releaseKill } from "../src/control.js";
import { indexTransactions } from "../src/indexer.js";
import { dayKey, emptyLedger, recordPrice } from "../src/ledger.js";
import { solUsd } from "../src/price.js";
import { rateProposal } from "../src/proposal.js";
import { decideRate } from "../src/rate.js";
import { allocate, commitRound, payoutParts, payoutTokens, planRound, recordSent, stageRound } from "../src/round.js";

const price: PriceContext = { priceUsd: 0.05, decimals: 6 };
const T = (n: number) => BigInt(Math.round(n * 1e6)); // whole tokens → base units
const TREASURY = "Treasury1111111111111111111111111111111111";
const DEV = "Dev11111111111111111111111111111111111111111";
const POOL = "Pool1111111111111111111111111111111111111111";
const ALICE = "Alice111111111111111111111111111111111111111";
const BOB = "Bob11111111111111111111111111111111111111111";
const MINER = "Miner11111111111111111111111111111111111111";
const platform = new Set([TREASURY, DEV]);
const DEV_ADDR = "3yGeMWedBKMLmygJjUDmqqyXVXoPx5tZqmZM9zbTqivn";
const MINT_PK = new PublicKey("GAEAkLoPnYHCVAabCipbxwcfdU4hVxLpheNsAhAxzyzc");
const MS_PK = new PublicKey("Kd3qnkz4NHGSFpoxNLXhwepJDyDA12JDZ7axDc3LFcR");
const t0 = Date.UTC(2026, 9, 5, 12);
let n = 0;
const tx = (at: number, ...deltas: [string, number][]): MintTx =>
  ({ signature: `sig${++n}`, at, deltas: deltas.map(([owner, d]) => ({ owner, account: `${owner}-ata`, delta: T(d) })) });

const fresh = () => ({ ...emptyLedger("devnet", "mint"), startedAt: 0 });

describe("indexer", () => {
  it("builds balances and hold clocks from transfers, counting outside trades as volume", () => {
    const l = fresh();
    // Treasury seeds the pool (not volume); Alice buys 2,000 ($100) from the pool; Bob buys dust.
    const vol = indexTransactions(l, [
      tx(t0, [TREASURY, -1_000_000], [POOL, 1_000_000]),
      tx(t0 + 1000, [POOL, -2000], [ALICE, 1900]),
      tx(t0 + 2000, [POOL, -100], [BOB, 95]),
    ], { price, rules: DEFAULT_RULES, platform });
    expect(vol).toBe(T(2100));
    expect(l.days[dayKey(t0)]!.volumeTokens).toBeCloseTo(2100, 6);
    expect(l.wallets[TREASURY]).toBeUndefined();
    expect(l.wallets[ALICE]!.balance).toBe(T(1900).toString());
    expect(l.wallets[ALICE]!.clockMs).toBe(0); // $95 bag ≥ $50: clock starts
    expect(l.wallets[BOB]!.clockMs).toBeNull(); // $4.75: too small to start the clock
    expect(l.tokenAccounts).toContain(`${ALICE}-ata`);
    expect(l.lastSignature).toBe(`sig${n}`);
    expect(l.ownFeesUnharvested).toBe("0"); // the seed transfer had no fee in this example
  });

  it("marks fees on the treasury's own transfers to go back to the treasury, not the pot", () => {
    const l = fresh();
    indexTransactions(l, [tx(t0, [TREASURY, -1000], [ALICE, 950]), tx(t0 + 1, [ALICE, -100], [BOB, 95])], { price, rules: DEFAULT_RULES, platform });
    expect(l.ownFeesUnharvested).toBe(T(50).toString());
  });

  it("history from before the take-over rebuilds balances but isn't counted as trading", () => {
    const l = { ...emptyLedger("devnet", "mint"), startedAt: t0 };
    const vol = indexTransactions(l, [tx(t0 - 1000, [POOL, -2000], [ALICE, 1900]), tx(t0 - 500, [TREASURY, -100], [BOB, 95])], { price, rules: DEFAULT_RULES, platform });
    expect(vol).toBe(0n);
    expect(l.days).toEqual({});
    expect(l.ownFeesUnharvested).toBe("0");
    expect(l.wallets[ALICE]!.balance).toBe(T(1900).toString());
  });

  it("selling takes time off the clock (2.5× the share sold)", () => {
    const l = fresh();
    indexTransactions(l, [tx(t0, [ALICE, 2000])], { price, rules: DEFAULT_RULES, platform });
    indexTransactions(l, [tx(t0 + 10 * HOUR_MS, [ALICE, -200], [POOL, 190])], { price, rules: DEFAULT_RULES, platform });
    expect(l.wallets[ALICE]!.clockMs).toBeCloseTo(10 * HOUR_MS * 0.75, -3);
  });
});

describe("rate", () => {
  const cfg = { lookbackDays: 2, minIntervalHours: 24 };
  it("leaves the rate alone with no trading", () => {
    expect(decideRate(emptyLedger("d", "m"), { now: t0, priceUsd: 0.05, liveBps: 500 }, cfg, DEFAULT_RULES)).toBeNull();
  });
  it("lowers it when trading is busy, once a day at most", () => {
    const l = emptyLedger("d", "m");
    l.days[dayKey(t0)] = { volumeTokens: 750 / 0.05, minedUsd: 2.5, taxTokens: 0, paidTokens: 0 }; // $750 per GPU
    const d = decideRate(l, { now: t0, priceUsd: 0.05, liveBps: 500 }, cfg, DEFAULT_RULES);
    expect(d?.bps).toBe(275);
    expect(decideRate(l, { now: t0, priceUsd: 0.05, liveBps: 500, scheduledBps: 275 }, cfg, DEFAULT_RULES)).toBeNull();
    l.rateChanges.push({ at: t0 - HOUR_MS, bps: 300, reason: "" });
    expect(decideRate(l, { now: t0, priceUsd: 0.05, liveBps: 500, scheduledBps: 300 }, cfg, DEFAULT_RULES)).toBeNull();
  });
  it("goes to 5% when miners can't reach 5×", () => {
    const l = emptyLedger("d", "m");
    l.days[dayKey(t0)] = { volumeTokens: 100 / 0.05, minedUsd: 2.5, taxTokens: 0, paidTokens: 0 };
    expect(decideRate(l, { now: t0, priceUsd: 0.05, liveBps: 275 }, cfg, DEFAULT_RULES)?.bps).toBe(500);
  });
});

describe("round", () => {
  const estimate = { mode: "estimate" as const, minAgeMs: 6 * HOUR_MS, budgetUsd: 0, ratio: 1 };
  const base = { roundId: "r1", rateBps: 500, price, levelPrice: price, rules: DEFAULT_RULES, excluded: new Set([...platform, POOL]), dev: DEV, payHolders: true, floatAvailableUsd: 1e9, settlement: estimate, minHolderPayoutUsd: 0.0001 };
  const commitX = (now: number, taxTokens: bigint) => ({ now, taxTokens, decimals: 6, settlementMode: "estimate" as const });
  const toTokens = (usd: number) => T(usd / 0.05);

  function ledgerWithHolderAndMiner() {
    const l = fresh();
    indexTransactions(l, [tx(t0 - 2 * 24 * HOUR_MS, [POOL, -20_000], [ALICE, 20_000])], { price, rules: DEFAULT_RULES, platform }); // $1,000, 2 days
    l.minedSinceRound[MINER] = 1;
    l.hoursInWindow[MINER] = 3;
    return l;
  }

  it("splits the tax, tops miners up, pays holders and dev, holds back 25% of mining", () => {
    const l = ledgerWithHolderAndMiner();
    const taxTokens = T(200); // $10
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens });
    expect(plan.taxUsd).toBeCloseTo(10, 9);
    expect(plan.split.shares.dev).toBeCloseTo(0.05, 9); // 5% of the tax at a 5% rate
    expect(plan.split.chestUsd).toBeCloseTo(4.5, 9); // 5× needs $4, but miners get at least 45% of the tax
    const miner = plan.payouts.find((p) => p.address === MINER)!;
    expect(miner.usd).toBeCloseTo(0.75 + 4.5, 9);
    expect(miner.buyUsd).toBeCloseTo(0.75, 9); // only the mining part is bought on the market
    expect(plan.buyUsd).toBeCloseTo(0.75, 9);
    const alice = plan.payouts.find((p) => p.address === ALICE)!;
    expect(alice.usd).toBeCloseTo(10 - 0.5 - 4.5, 9);
    expect(plan.payouts.find((p) => p.kind === "dev")!.usd).toBeCloseTo(0.5, 9);

    const amounts = plan.payouts.map((p) => toTokens(p.usd));
    commitRound(l, plan, commitX(t0, taxTokens), amounts, amounts);
    expect(l.round).toBe(1);
    expect(l.minedSinceRound).toEqual({});
    expect(l.pending).toHaveLength(1);
    expect(l.pending[0]!.estimatedUsd).toBeCloseTo(0.25, 9);
    expect(Number(l.totals.taxTokens)).toBe(Number(taxTokens));
  });

  it("owes failed payouts and pays them first next round; settles held-back mining once mature", () => {
    const l = ledgerWithHolderAndMiner();
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens: T(200) });
    const amounts = plan.payouts.map((p) => toTokens(p.usd));
    const sent = plan.payouts.map((p, i) => (p.address === ALICE ? undefined : amounts[i]));
    commitRound(l, plan, commitX(t0, T(200)), amounts, sent);
    expect(l.owed.map((o) => o.address)).toEqual([ALICE]);
    expect(l.owed[0]!.tokens).toBe(amounts[plan.payouts.findIndex((p) => p.address === ALICE)]!.toString()); // retried with the same tokens
    expect(l.paid[ALICE]).toBeUndefined();

    const later = t0 + 7 * HOUR_MS;
    const next = planRound({ ...base, ledger: l, now: later, taxTokens: 0n, payHolders: false });
    expect(next.payouts[0]!.address).toBe(ALICE);
    expect(next.payouts[0]!.why).toMatch(/^retry: /);
    const settled = next.payouts.find((p) => p.kind === "settle")!;
    expect(settled.address).toBe(MINER);
    expect(settled.usd).toBeCloseTo(0.25, 9);
    expect(settled.buyUsd).toBeCloseTo(0.25, 9);
    commitRound(l, next, commitX(later, 0n), next.payouts.map(() => 1n), next.payouts.map(() => 1n));
    expect(l.owed).toEqual([]);
    expect(l.pending).toEqual([]);
  });

  it("carries the bonus when nobody mined, and the holder pot when holders aren't paid this round", () => {
    const l = emptyLedger("devnet", "mint");
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens: T(200), payHolders: false });
    expect(plan.payouts.map((p) => p.kind)).toEqual(["dev"]);
    expect(plan.chestCarryUsd).toBeCloseTo(plan.split.chestUsd, 9);
    expect(plan.holderCarryUsd).toBeCloseTo(plan.split.holderUsd, 9);
  });

  it("pays only what the float can buy now; the rest of the mining is held back", () => {
    const l = ledgerWithHolderAndMiner();
    l.minedSinceRound[MINER] = 4; // wants $3 now (75%)
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens: 0n, floatAvailableUsd: 1 });
    const miner = plan.payouts.find((p) => p.address === MINER)!;
    expect(miner.buyUsd).toBeCloseTo(1, 9);
    expect(plan.epoch.pending[0]!.estimatedUsd).toBeCloseTo(3, 9);
  });

  it("settles held-back mining from coin sales only, oldest first, at the sale's ratio", () => {
    const l = fresh();
    l.pending = [
      { epochId: "e1", address: MINER, estimatedUsd: 1, miningUsd: 4, immediateUsd: 3, at: t0 - 20 * HOUR_MS },
      { epochId: "e2", address: ALICE, estimatedUsd: 1, miningUsd: 4, immediateUsd: 3, at: t0 - 15 * HOUR_MS },
      { epochId: "e3", address: BOB, estimatedUsd: 1, miningUsd: 4, immediateUsd: 3, at: t0 - HOUR_MS }, // too young
    ];
    l.funding.saleBudgetUsd = 2;
    const sales = { mode: "sales" as const, minAgeMs: 10 * HOUR_MS, budgetUsd: 2, ratio: 0.9 };
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens: 0n, payHolders: false, settlement: sales });
    // At 0.9x, $4 of mining is worth $3.60 and $3 was paid: $0.60 each. Both fit the $2 of proceeds.
    expect(plan.payouts.filter((p) => p.kind === "settle").map((p) => [p.address, +p.usd.toFixed(6)])).toEqual([[MINER, 0.6], [ALICE, 0.6]]);
    expect(plan.settledUsd).toBeCloseTo(1.2, 9);
    commitRound(l, plan, { now: t0, taxTokens: 0n, decimals: 6, settlementMode: "sales" }, plan.payouts.map(() => 1n), plan.payouts.map(() => 1n));
    expect(l.pending.map((p) => p.epochId)).toEqual(["e3"]);
    expect(l.funding.saleBudgetUsd).toBeCloseTo(0.8, 9);
    // Without proceeds nothing settles.
    const none = planRound({ ...base, ledger: { ...l, pending: [{ ...l.pending[0]!, at: t0 - 20 * HOUR_MS }] }, now: t0, taxTokens: 0n, payHolders: false, settlement: { ...sales, budgetUsd: 0 } });
    expect(none.payouts).toEqual([]);
  });

  it("a round that crashes after its buy leaves every unsent payout owed with its tokens, never bought twice", () => {
    const l = ledgerWithHolderAndMiner();
    l.taxUnallocated = T(200).toString(); // harvested and saved, then the process died once already
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens: BigInt(l.taxUnallocated) });
    const amounts = payoutTokens(plan.payouts, T(14), toTokens); // the buy delivered 14 tokens
    const staged = stageRound(l, plan, commitX(t0, T(200)), amounts);
    expect(l.taxUnallocated).toBe("0");
    expect(l.owed).toHaveLength(plan.payouts.length);
    expect(l.owed.every((o) => o.tokens !== undefined)).toBe(true);
    const a = plan.payouts.findIndex((p) => p.address === ALICE);
    recordSent(l, staged[a]!, amounts[a]!, { now: t0, decimals: 6 }); // Alice's transfer landed, then a crash
    expect(l.paid[ALICE]!.holder).toBe(amounts[a]!.toString());
    expect(l.owed).toHaveLength(plan.payouts.length - 1);
    const next = planRound({ ...base, ledger: l, now: t0 + HOUR_MS, taxTokens: 0n, payHolders: false });
    expect(next.buyUsd).toBe(0); // the miner's bought tokens are already in hand
    const miner = next.payouts.find((p) => p.address === MINER)!;
    expect(miner.tokens).toBe(amounts[plan.payouts.findIndex((p) => p.address === MINER)]!.toString());
  });

  it("a buy that can't happen (graduating) keeps the bonus in tokens, so a price crash before the retry can't inflate it", () => {
    const l = ledgerWithHolderAndMiner();
    const plan = planRound({ ...base, ledger: l, now: t0, taxTokens: T(200), payHolders: false });
    const parts = payoutParts(plan.payouts, null, toTokens); // no buy this round
    const m = plan.payouts.findIndex((p) => p.address === MINER);
    expect(parts[m]!.total).toBeUndefined();
    commitRound(l, plan, commitX(t0, T(200)), parts.map((x) => x.total), parts.map((x) => x.total), parts.map((x) => x.fromTax));
    const owed = l.owed.find((o) => o.address === MINER)!;
    expect(owed.taxTokens).toBe(toTokens(4.5).toString()); // the $4.50 bonus at $0.05
    // Next round the price has fallen 5×: the bonus stays 90 tokens; only the mining is bought.
    const next = planRound({ ...base, ledger: l, now: t0 + HOUR_MS, taxTokens: 0n, payHolders: false, price: { priceUsd: 0.01, decimals: 6 } });
    const retry = next.payouts.find((p) => p.address === MINER)!;
    expect(next.buyUsd).toBeCloseTo(0.75, 9);
    expect(payoutParts([retry], T(70), (usd) => T(usd / 0.01))[0]!.total).toBe(T(90) + T(70));
  });

  it("gives miners exactly what their mining bought; a failed buy keeps them owed", () => {
    const payouts = [
      { address: MINER, usd: 3, buyUsd: 1, kind: "miner" as const, why: "" }, // $1 mining + $2 bonus
      { address: BOB, usd: 0.5, buyUsd: 0.5, kind: "settle" as const, why: "" },
      { address: ALICE, usd: 2, kind: "holder" as const, why: "" },
      { address: DEV, usd: 1, kind: "dev" as const, why: "", tokens: "123" },
    ];
    // The buy of $1.50 of mining delivered 27 tokens (worse than the 30 the spot price says).
    expect(payoutTokens(payouts, T(27), toTokens)).toEqual([T(18) + T(40), T(9), T(40), 123n]);
    expect(payoutTokens(payouts, null, toTokens)).toEqual([undefined, undefined, T(40), 123n]);
    expect(allocate(10n, [1, 2])).toEqual([3n, 7n]);
    expect(allocate(0n, [1])).toEqual([0n]);
  });
});

describe("indexer: our own buys and the graduation", () => {
  it("a market buy by the treasury isn't trading volume, and its withheld fee goes back to the treasury", () => {
    const l = fresh();
    const vol = indexTransactions(l, [tx(t0, [POOL, -1000], [TREASURY, 950])], { price, rules: DEFAULT_RULES, platform, pools: new Set([POOL]) });
    expect(vol).toBe(0n);
    expect(l.ownFeesUnharvested).toBe(T(50).toString());
  });
  it("moving liquidity from the curve to DAMM v2 isn't trading; a trader's buy is", () => {
    const l = fresh();
    const DAMM = "Damm1111111111111111111111111111111111111111";
    const pools = new Set([POOL, DAMM]);
    expect(indexTransactions(l, [tx(t0, [POOL, -5000], [DAMM, 4750])], { price, rules: DEFAULT_RULES, platform, pools })).toBe(0n);
    expect(indexTransactions(l, [tx(t0 + 1, [DAMM, -100], [ALICE, 95])], { price, rules: DEFAULT_RULES, platform, pools })).toBe(T(100));
  });
});

describe("prices", () => {
  it("levels use the higher of the 1h and 7-day averages", () => {
    const l = fresh();
    recordPrice(l, t0, 0.1);
    expect(recordPrice(l, t0 + 2 * HOUR_MS, 0.04)).toBeCloseTo(0.07, 9); // 1h: 0.04, 7d: 0.07
    expect(sqrtPriceToPrice(2n ** 64n, 6, 9)).toBeCloseTo(0.001, 12); // sqrt price 1 = 1 lamport per base unit
  });
  it("buys a little extra so the transfer fee doesn't come out of miners' pay", () => {
    expect(lamportsForUsd(100, 200, 500)).toBe(BigInt(Math.ceil(0.5e9 / 0.95)));
    expect(lamportsForUsd(0, 200, 500)).toBe(0n);
  });
  it("SOL/USD from Jupiter, CoinGecko as a fallback, bounds checked", async () => {
    const cfg = { source: "live" as const, min: 5, max: 5000 };
    const SOL = "So11111111111111111111111111111111111111112";
    const reply = (map: Record<string, unknown>) => (async (url: string) => {
      const body = map[new URL(url).host];
      if (body === undefined) throw new Error("down");
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch;
    expect(await solUsd(cfg, reply({ "lite-api.jup.ag": { [SOL]: { usdPrice: 103.4 } } }), t0)).toEqual({ usd: 103.4, from: "jupiter" });
    expect(await solUsd(cfg, reply({ "lite-api.jup.ag": { [SOL]: { usdPrice: 0.01 } }, "api.coingecko.com": { solana: { usd: 104 } } }), t0)).toEqual({ usd: 104, from: "coingecko" });
    expect((await solUsd(cfg, reply({}), t0 + 60_000)).from).toBe("coingecko (cached)");
    await expect(solUsd(cfg, reply({}), t0 + 3 * HOUR_MS)).rejects.toThrow("no SOL price");
  });
});

describe("safety", () => {
  it("the kill switch blocks every send on the connection, mid-round included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hash-kill-"));
    let sends = 0;
    const conn = new Connection("http://127.0.0.1:1");
    conn.sendRawTransaction = async () => { sends += 1; return "sig"; };
    guardSends(conn, () => killReason(dir, null));
    await conn.sendRawTransaction(Buffer.from([1]));
    engageKill(dir, "testing");
    expect(killReason(dir, null)).toMatch(/kill switch engaged: .*testing/);
    await expect(conn.sendRawTransaction(Buffer.from([1]))).rejects.toBeInstanceOf(SendBlockedError);
    await expect(conn.sendEncodedTransaction("x")).rejects.toThrow("send blocked");
    expect(releaseKill(dir)).toBe(true);
    await conn.sendRawTransaction(Buffer.from([1]));
    expect(sends).toBe(2);
    expect(killReason(dir, "HASH_KILL=1")).toMatch(/HASH_KILL/);
  });

  it("alerts go to the webhook, repeat at most every repeatMs, and come back straight away once resolved", async () => {
    const posted: unknown[] = [];
    let now = t0;
    const a = new Alerts({ webhook: "https://hooks.example/x", repeatMs: 30 * 60_000, label: "$HASH payouts (devnet)", post: async (_u, b) => { posted.push(b); }, now: () => now, print: () => {} });
    expect(await a.raise("float-low", "warning", "float is $3")).toBe(true);
    expect(await a.raise("float-low", "warning", "float is $2")).toBe(false);
    now += 31 * 60_000;
    expect(await a.raise("float-low", "warning", "float is $1")).toBe(true);
    a.resolve("float-low");
    expect(await a.raise("float-low", "warning", "again")).toBe(true);
    expect(posted).toHaveLength(3);
    expect(posted[0]).toMatchObject({ key: "float-low", level: "warning", content: expect.stringContaining("float is $3"), text: expect.stringContaining("devnet") });
    const w = new RpcWatch(10 * 60_000);
    w.record({ at: t0, method: "getBalance", error: "HTTP 429" });
    w.record({ at: t0 + 1, method: "getBalance", error: "HTTP 429" });
    expect(w.summary(t0 + 2)).toBe("2× getBalance HTTP 429");
    expect(w.recent(t0 + 11 * 60_000)).toHaveLength(0);
  });

  it("refuses an unsafe mainnet setup", () => {
    const cfg: PayoutsConfig = {
      network: "mainnet", rpcPauseMs: 0, collectorMinutes: 5, roundMinutes: 30, holderEveryRounds: 1, decimals: 6,
      market: { mint: MINT_PK.toBase58(), dbcConfig: MINT_PK.toBase58() },
      solUsd: { source: "live", min: 5, max: 5000 }, buy: { slippageBps: 300, maxCostBps: 500, maxUsdPerRound: 500 },
      funding: { reserveSol: 0.05, claimPartnerFeeMinSol: 0.01 }, settlement: { mode: "sales", minAgeHours: 10 },
      rate: { adjust: true, lookbackDays: 2, minIntervalHours: 24 }, minHolderPayoutUsd: 0.01, maxPayoutUsdPerRound: 5000, minTreasurySol: 0.02,
      alerts: { emptyHarvestRounds: 6, floatLowUsd: 50, rpcErrorsPer10Min: 20, repeatMinutes: 30 },
    };
    const ok = { HASH_MAINNET: "yes", HASH_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=x", HASH_KEYPAIR: join(tmpdir(), "payout.json"), HASH_DEV_WALLET: DEV_ADDR };
    expect(checkRuntime(cfg, "x", ok).warnings).toHaveLength(2); // no multisig, no webhook
    expect(() => checkRuntime(cfg, "x", { ...ok, HASH_MAINNET: undefined })).toThrow("HASH_MAINNET=yes");
    expect(() => checkRuntime(cfg, "x", { ...ok, HASH_RPC_URL: "https://api.mainnet-beta.solana.com" })).toThrow("dedicated RPC");
    expect(() => checkRuntime(cfg, "x", { ...ok, HASH_KEYPAIR: undefined })).toThrow("HASH_KEYPAIR");
    expect(() => checkRuntime(cfg, "x", { ...ok, HASH_KEYPAIR: "packages/chain/data/x.json" })).toThrow("inside the repository");
    expect(() => checkRuntime({ ...cfg, simulate: { miners: [{ wallet: ALICE, usdPerHour: 1 }] } }, "x", ok)).toThrow("devnet only");
    expect(() => checkRuntime({ ...cfg, settlement: { mode: "estimate", minAgeHours: 1 } }, "x", ok)).toThrow("sales");
  });

  it("writes a rate change for the multisig instead of sending it", () => {
    const p = rateProposal({ mint: MINT_PK, multisig: MS_PK, bps: 275, maxFee: 10n, reason: "2d: busy", now: t0 });
    expect(p.what).toMatch(/2.75%/);
    expect(p.instruction.programId).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    expect(p.instruction.accounts.find((a) => a.isSigner)!.pubkey).toBe(MS_PK.toBase58());
  });
});
