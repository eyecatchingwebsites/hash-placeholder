// One full $HASH round on Solana devnet, with real mining data from the collector:
//   create the Token-2022 mint (5% transfer fee) → give test holders their bags → they trade, so the
//   tax builds up → harvest the tax → split it with the engine → pay miners, holders and dev →
//   write a public report of the round with every transaction.
//
//   npx tsx packages/chain/scripts/devnet-run.ts            reuse the mint from the last run
//   npx tsx packages/chain/scripts/devnet-run.ts --fresh    create a new mint
//
// Keys are throwaway devnet keypairs in packages/chain/data/ (gitignored). Never use them on mainnet.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { DEFAULT_RULES, runEpoch, runHolderPayout, splitTax, type WalletState } from "@hashcoin/engine";
import { ata, createHashMint, harvestFees, sendBatch, tokenBalance, type Transfer } from "../src/token.js";
import { usdToBaseUnits } from "../src/fees.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DATA = here("../data");
const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const DECIMALS = 6;
const SUPPLY = 21_000_000n; // user, Oct 4
const FEE = { bps: 500, max: SUPPLY * 10n ** BigInt(DECIMALS) }; // cap = whole supply, so the 5% always applies
/** Devnet has no market, so assume a price: $1M market cap at 21M supply. */
const PRICE_USD = 1_000_000 / 21_000_000;
/** Test holders' bags in USD: below H1, H1, H2-sized, H3-sized (no hold clock has run yet, so all pay as H1). */
const BAGS_USD = [30, 600, 3_000, 8_000];

const solscan = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const tokens = (base: bigint) => Number(base) / 10 ** DECIMALS;
const readJson = <T>(path: string, fallback: T): T => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; } };
const kp = (secret: number[]) => Keypair.fromSecretKey(Uint8Array.from(secret));

/** Miner wallets from the collector's last run (their token accounts may hold withheld fees from earlier payouts). */
function minerOwners(): PublicKey[] {
  const c = readJson<{ PRL?: { wallets?: { wallet: string }[] } }>(here("../../../services/collector/data/latest.json"), {});
  return (c.PRL?.wallets ?? []).map((w) => new PublicKey(w.wallet));
}

async function main() {
  mkdirSync(DATA, { recursive: true });
  const conn = new Connection(RPC, "confirmed");

  // --- Throwaway keys: the treasury (also pays fees and holds both fee authorities on devnet), dev, and test holders.
  const keyFile = `${DATA}/devnet-keys.json`;
  const saved = readJson<{ treasury: number[]; dev: number[]; holders: number[][] } | null>(keyFile, null);
  const keys = saved ?? { treasury: [...Keypair.generate().secretKey], dev: [...Keypair.generate().secretKey], holders: BAGS_USD.map(() => [...Keypair.generate().secretKey]) };
  if (!saved) writeFileSync(keyFile, JSON.stringify(keys));
  const treasury = kp(keys.treasury), dev = kp(keys.dev), holders = keys.holders.map(kp);
  console.log(`treasury ${treasury.publicKey.toBase58()}`);

  // --- SOL for rent and fees: ~0.02 SOL for the first round (mint + 7 token accounts), much less after.
  let sol = await conn.getBalance(treasury.publicKey);
  if (sol < 0.02 * LAMPORTS_PER_SOL) {
    console.log("asking the devnet faucet for 1 SOL ...");
    try {
      const sig = await conn.requestAirdrop(treasury.publicKey, LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
      sol = await conn.getBalance(treasury.publicKey);
    } catch (e) {
      // A later round only needs rent for a couple of new token accounts plus fees.
      if (sol < 0.006 * LAMPORTS_PER_SOL) {
        throw new Error(`devnet faucet refused (${(e as Error).message.split("\n")[0]}). Fund ${treasury.publicKey.toBase58()} at https://faucet.solana.com (devnet), then run again.`);
      }
      console.log("faucet refused; carrying on with what's left");
    }
  }
  console.log(`treasury SOL ${sol / LAMPORTS_PER_SOL}`);

  // --- The mint.
  const stateFile = `${DATA}/devnet-state.json`;
  let state = readJson<{ mint?: string; rounds?: number }>(stateFile, {});
  if (!state.mint || process.argv.includes("--fresh")) {
    const { mint, signature } = await createHashMint(conn, treasury, {
      decimals: DECIMALS, supply: SUPPLY, feeBps: FEE.bps, maxFee: FEE.max,
      feeConfigAuthority: treasury.publicKey, withdrawAuthority: treasury.publicKey, supplyTo: treasury.publicKey,
    });
    state = { mint: mint.toBase58(), rounds: 0 };
    writeFileSync(stateFile, JSON.stringify(state));
    console.log(`created $HASH (devnet) ${mint.toBase58()}: 5% transfer fee, mint authority revoked, no freeze authority\n  ${solscan(signature)}`);
  }
  const mint = new PublicKey(state.mint!);
  const report: Record<string, unknown> = { network: "devnet", at: new Date().toISOString(), mint: mint.toBase58(), priceUsdAssumed: PRICE_USD, transactions: [] as string[] };
  const txs = report.transactions as string[];

  // --- Holders get their bags (a "buy" is a transfer out of the pool, taxed the same way).
  for (const [i, h] of holders.entries()) {
    const want = usdToBaseUnits(BAGS_USD[i]!, PRICE_USD, DECIMALS);
    const have = await tokenBalance(conn, h.publicKey, mint);
    if (have < want) {
      const sent = await sendBatch(conn, treasury, treasury, mint, DECIMALS, FEE, [{ to: h.publicKey, amount: want - have }], { netOfFee: false });
      txs.push(...sent.map((s) => s.signature));
    }
  }

  // --- Trading: each holder sends 10% of its bag to the next one. Every transfer withholds 5%.
  let volume = 0n;
  for (const [i, h] of holders.entries()) {
    const bal = await tokenBalance(conn, h.publicKey, mint);
    const amount = bal / 10n;
    if (amount <= 0n) continue;
    const to = holders[(i + 1) % holders.length]!.publicKey;
    const sent = await sendBatch(conn, treasury, h, mint, DECIMALS, FEE, [{ to, amount }], { netOfFee: false });
    txs.push(...sent.map((s) => s.signature));
    volume += amount;
  }
  console.log(`test trades: ${tokens(volume).toLocaleString()} $HASH of volume`);

  // --- Harvest the tax into the treasury.
  // The public RPC won't scan Token-2022, so check the token accounts this round touched (on mainnet
  // the transfer indexer supplies every account it has seen).
  const known = [treasury.publicKey, dev.publicKey, ...holders.map((h) => h.publicKey), ...minerOwners()].map((o) => ata(o, mint));
  const { harvested, signatures } = await harvestFees(conn, treasury, mint, treasury, treasury.publicKey, known);
  txs.push(...signatures);
  const taxUsd = tokens(harvested) * PRICE_USD;
  console.log(`tax harvested: ${tokens(harvested).toLocaleString()} $HASH ($${taxUsd.toFixed(2)})`);

  // --- Mining from the collector (real Kryptex data for the user's GPU).
  const collector = readJson<{ PRL?: { wallets?: { wallet: string; minedUsd: number; hoursInWindow: number }[] } }>(here("../../../services/collector/data/latest.json"), {});
  const miners = (collector.PRL?.wallets ?? []).filter((w) => w.minedUsd > 0);
  const minedUsd = miners.reduce((a, w) => a + w.minedUsd, 0);

  // --- Split the tax and run the engine.
  const split = splitTax({ taxUsd, minedUsd }, DEFAULT_RULES);
  const price = { priceUsd: PRICE_USD, decimals: DECIMALS };
  const now = Date.now();
  const walletState = async (owner: PublicKey): Promise<WalletState> =>
    ({ address: owner.toBase58(), balance: await tokenBalance(conn, owner, mint), clockMs: 0, clockAt: now });
  const minerWallets = new Map<string, WalletState>();
  for (const m of miners) minerWallets.set(m.wallet, await walletState(new PublicKey(m.wallet)));
  const epoch = runEpoch({
    epochId: `devnet-${(state.rounds ?? 0) + 1}`, now, earnings: new Map(miners.map((m) => [m.wallet, m.minedUsd])),
    hoursMined: new Map(miners.map((m) => [m.wallet, m.hoursInWindow])), wallets: minerWallets, price,
    chestUsd: split.chestUsd, floatAvailableUsd: 1e9, rules: DEFAULT_RULES, excluded: new Set([treasury.publicKey.toBase58(), dev.publicKey.toBase58()]),
  });
  const holderStates = await Promise.all(holders.map((h) => walletState(h.publicKey)));
  const holderPay = runHolderPayout({ now, potUsd: split.holderUsd, wallets: holderStates, price, rules: DEFAULT_RULES, excluded: new Set([treasury.publicKey.toBase58()]) });

  // --- Pay out. Devnet has no market, so the treasury pays the mining part from its own supply;
  // on mainnet that part (epoch.totals.buyUsd) is bought on the market first.
  const payouts: (Transfer & { why: string })[] = [
    ...epoch.lines.map((l) => ({ to: new PublicKey(l.address), amount: usdToBaseUnits(l.payNowUsd, PRICE_USD, DECIMALS), why: `miner M${l.level}: mining $${l.immediateUsd.toFixed(4)} now + bonus $${l.chestUsd.toFixed(4)}` })),
    ...holderPay.lines.map((l) => ({ to: new PublicKey(l.address), amount: usdToBaseUnits(l.usd, PRICE_USD, DECIMALS), why: `holder H${l.holderLevel}: $${l.usd.toFixed(4)}` })),
    { to: dev.publicKey, amount: usdToBaseUnits(split.devUsd, PRICE_USD, DECIMALS), why: `dev: $${split.devUsd.toFixed(4)}` },
  ].filter((p) => p.amount > 0n);
  const sent = await sendBatch(conn, treasury, treasury, mint, DECIMALS, FEE, payouts, { netOfFee: true });
  txs.push(...sent.map((s) => s.signature));

  // --- The public record of this round.
  state.rounds = (state.rounds ?? 0) + 1;
  writeFileSync(stateFile, JSON.stringify(state));
  Object.assign(report, {
    round: state.rounds, volumeTokens: tokens(volume), taxHarvestedTokens: tokens(harvested), taxUsd, minedUsd, split,
    miners: epoch.lines, holders: holderPay.lines, holderCarryUsd: holderPay.carryUsd, chestCarryUsd: epoch.carryUsd,
    payouts: payouts.map((p) => ({ to: p.to.toBase58(), tokens: tokens(p.amount), why: p.why })),
    payoutTransactions: sent.map((s) => solscan(s.signature)),
  });
  const reportFile = `${DATA}/round-${state.rounds}.json`;
  writeFileSync(reportFile, JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  console.log(`\nsplit of $${taxUsd.toFixed(2)} tax: dev $${split.devUsd.toFixed(4)} | miner bonus $${split.chestUsd.toFixed(4)} | holders $${split.holderUsd.toFixed(4)}`);
  for (const p of payouts) console.log(`  ${tokens(p.amount).toLocaleString()} $HASH → ${p.to.toBase58().slice(0, 8)}…  (${p.why})`);
  console.log(`\npayout transactions:\n  ${sent.map((s) => solscan(s.signature)).join("\n  ")}`);
  console.log(`token: https://solscan.io/token/${mint.toBase58()}?cluster=devnet\nreport: ${reportFile}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
