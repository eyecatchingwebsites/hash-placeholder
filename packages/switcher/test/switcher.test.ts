import { describe, expect, it } from "vitest";
import {
  applyPayoutAddresses, assignGpu, canonicalJson, decide, gpuKey, isPayoutAddress, isSolanaAddress, loadSigningKey, newSigningKey, poolUser, scoreCoins,
  signPayload, vendorOf, verifyEnvelope, workerId, type CoinInfo, type GpuReport, type ScoreInputs, type SwitchPolicy,
} from "../src/index.js";
import { createPublicKey } from "node:crypto";

const coins: CoinInfo[] = [
  { id: "PRL", algo: "pearlhash", enabled: true, vendors: ["nvidia", "amd"], liquidityUsdPerDay: 50000, confirmHours: 10,
    pools: [{ url: "stratum+tcp://prl.example:3333", region: "eu" }], payoutAddress: "prl1platform", miner: { nvidia: "prlminer", amd: "prlminer" } },
  { id: "QTC", algo: "qhash", enabled: true, vendors: ["amd", "intel", "nvidia"], liquidityUsdPerDay: 20000, confirmHours: 1,
    pools: [{ url: "stratum+tcp://qtc-us.example:4444", region: "us" }, { url: "stratum+tcp://qtc-eu.example:4444", region: "eu" }],
    payoutAddress: "qtcplatform", miner: { amd: "qminer", intel: "qminer", nvidia: "qminer" } },
  { id: "OFF", algo: "x", enabled: false, vendors: ["nvidia"], liquidityUsdPerDay: 1e9, confirmHours: 0,
    pools: [{ url: "stratum+tcp://off:1", region: "us" }], payoutAddress: "x", miner: { nvidia: "m" } },
];
const quotes = [
  { gpu: "rtx4070", coin: "PRL", usdPerDay: 2.96 },
  { gpu: "rtx4070", coin: "QTC", usdPerDay: 1.5 },
  { gpu: "rtx4070", coin: "OFF", usdPerDay: 99 },
  { gpu: "rx7900xtx", coin: "QTC", usdPerDay: 1.56 },
  { gpu: "rx7900xtx", coin: "PRL", usdPerDay: 1.2 },
];
const S: ScoreInputs = { platformSellUsdPerDay: {}, delayRiskPerHour: 0.002, slippageK: 0.5, slippageCap: 0.3 };
const P: SwitchPolicy = { minGain: 0.1, sustainMs: 30 * 60_000, minDwellMs: 2 * 3600_000 };
const nv: GpuReport = { index: 0, name: "NVIDIA GeForce RTX 4070", vendor: "nvidia" };
const amd: GpuReport = { index: 1, name: "AMD Radeon RX 7900 XTX", vendor: "amd" };
const WALLET = "4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF";

describe("gpu names", () => {
  it("normalizes driver names", () => {
    expect(gpuKey("NVIDIA GeForce RTX 4070")).toBe("rtx4070");
    expect(gpuKey("NVIDIA GeForce RTX 3060 Laptop GPU")).toBe("rtx3060laptop");
    expect(gpuKey("AMD Radeon RX 7900 XTX")).toBe("rx7900xtx");
    expect(gpuKey("NVIDIA GeForce RTX 4060 Ti 16GB")).toBe("rtx4060ti16gb");
    expect(vendorOf("AMD Radeon RX 6600")).toBe("amd");
    expect(vendorOf("Intel(R) Arc(TM) A770 Graphics")).toBe("intel");
  });
});

describe("scoring", () => {
  it("picks PRL for NVIDIA and QTC for AMD, skipping disabled coins", () => {
    expect(scoreCoins(nv, coins, quotes, S)[0]!.coin).toBe("PRL");
    expect(scoreCoins(amd, coins, quotes, S)[0]!.coin).toBe("QTC");
    expect(scoreCoins(nv, coins, quotes, S).some((s) => s.coin === "OFF")).toBe(false);
  });

  it("prefers the rig's own benchmark over catalog data", () => {
    const s = scoreCoins({ ...nv, benchmarks: [{ coin: "QTC", usdPerDay: 5 }] }, coins, quotes, S);
    expect(s[0]).toMatchObject({ coin: "QTC", source: "benchmark" });
  });

  it("penalizes coins the platform already sells heavily", () => {
    const heavy = { ...S, platformSellUsdPerDay: { PRL: 100000 } };
    expect(scoreCoins(nv, coins, quotes, heavy)[0]!.netUsdPerDay).toBeLessThan(scoreCoins(nv, coins, quotes, S)[0]!.netUsdPerDay);
  });
});

describe("hysteresis", () => {
  const sc = (a: number, b: number) => [{ coin: "A", grossUsdPerDay: a, netUsdPerDay: a, source: "catalog" as const },
    { coin: "B", grossUsdPerDay: b, netUsdPerDay: b, source: "catalog" as const }].sort((x, y) => y.netUsdPerDay - x.netUsdPerDay);
  const t0 = 1_000_000_000;

  it("does not switch for a small gain", () => {
    const d = decide(sc(1, 1.05), { coin: "A", since: t0 - 1e9, challenger: null }, t0, P);
    expect(d.coin).toBe("A");
  });

  it("switches only after the gain is sustained", () => {
    let st = { coin: "A", since: t0 - 1e9, challenger: null as null | { coin: string; since: number } };
    let d = decide(sc(1, 1.5), st, t0, P);
    expect(d.coin).toBe("A");
    d = decide(sc(1, 1.5), d.state as typeof st, t0 + 31 * 60_000, P);
    expect(d.coin).toBe("B");
  });

  it("resets the challenger when the gain disappears", () => {
    const d1 = decide(sc(1, 1.5), { coin: "A", since: 0, challenger: null }, t0, P);
    const d2 = decide(sc(1, 1.0), d1.state, t0 + 10 * 60_000, P);
    expect(d2.state.challenger).toBeNull();
  });

  it("respects minimum dwell after a switch", () => {
    const d = decide(sc(1, 2), { coin: "A", since: t0, challenger: { coin: "B", since: t0 - 3600_000 } }, t0 + 60_000, P);
    expect(d.coin).toBe("A");
  });
});

describe("assignment + signing", () => {
  it("builds a per-GPU assignment: platform payout address, short worker id, regional pool", () => {
    const r = assignGpu({ wallet: WALLET, rigId: "pc1" }, amd, null, 1000, { coins, quotes, score: S, policy: P, ttlMs: 900_000, region: "eu" });
    expect(r.assignment).toMatchObject({ coin: "QTC", minerId: "qminer", pool: { url: "stratum+tcp://qtc-eu.example:4444", user: `qtcplatform.${workerId(WALLET, "pc1")}-1` }, expiresAt: 901_000 });
  });

  it("worker ids are short, stable and match the app's (apps/desktop/core/src/wallet.rs)", () => {
    expect(workerId("4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF", "gamingpc")).toBe("hvrq3qmrph6");
    expect(workerId("4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF", "pc1")).toBe("hwac5yjdrn2");
    expect(workerId("4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF", "pc1")).toMatch(/^h[a-z2-7]{10}$/);
  });

  it("never assigns a coin without a platform payout address", () => {
    const noPayout = coins.map((c) => ({ ...c, payoutAddress: undefined }));
    expect(scoreCoins(amd, noPayout, quotes, { ...S, platformSellUsdPerDay: {} })).toEqual([]);
  });

  it("payout addresses: env overrides, production refuses test addresses, logins can't be broken", () => {
    const PRL = "prl1pgd7htaqjvw0x0vfwaqadprkht3l37wfw5chr82vpp5kmmpyuw4pq2zzx4h";
    const cfg = [{ ...coins[0]!, id: "PRL", payoutAddress: PRL, payoutAddressIsTest: true }];
    expect(isPayoutAddress("PRL", PRL)).toBe(true);
    expect(isPayoutAddress("PRL", "prl1.evil")).toBe(false);
    expect(isPayoutAddress("PRL", "bc1qxyz")).toBe(false);
    // Devnet: the test address is used and labelled.
    expect(applyPayoutAddresses(cfg, {}, { production: false }).coins[0]!.payoutAddress).toBe(PRL);
    // Production: no test address, so PRL is never assigned until one is set.
    const prod = applyPayoutAddresses(cfg, {}, { production: true });
    expect(prod.coins[0]!.payoutAddress).toBeUndefined();
    expect(scoreCoins(amd, prod.coins, quotes, { ...S, platformSellUsdPerDay: {} }).find((s) => s.coin === "PRL")).toBeUndefined();
    const platform = "prl1qw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k";
    expect(applyPayoutAddresses(cfg, { HASH_PAYOUT_ADDRESS_PRL: platform }, { production: true }).coins[0]!.payoutAddress).toBe(platform);
    expect(() => applyPayoutAddresses(cfg, { HASH_PAYOUT_ADDRESS_PRL: "prl1oops.x" }, { production: true })).toThrow("not a valid PRL address");
    expect(() => poolUser("addr.other", WALLET, "pc1", 0)).toThrow();
    expect(poolUser(platform, WALLET, "pc1", 2)).toBe(`${platform}.${workerId(WALLET, "pc1")}-2`);
  });

  it("signs and verifies; tampering fails", () => {
    const { privatePem } = newSigningKey();
    const key = loadSigningKey(privatePem);
    const env = signPayload({ b: 1, a: [1, { d: 2, c: 3 }] }, key, "k1");
    expect(env.payload).toBe(canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
    const pub = createPublicKey(key);
    expect(verifyEnvelope(env, { k1: pub })).toEqual({ a: [1, { c: 3, d: 2 }], b: 1 });
    expect(() => verifyEnvelope({ ...env, payload: env.payload.replace("1", "2") }, { k1: pub })).toThrow("bad signature");
    expect(() => verifyEnvelope(env, {})).toThrow("unknown key id");
  });

  it("validates Solana addresses", () => {
    expect(isSolanaAddress(WALLET)).toBe(true);
    expect(isSolanaAddress("not-a-wallet")).toBe(false);
    expect(isSolanaAddress("0OIl" + WALLET.slice(4))).toBe(false);
  });
});
