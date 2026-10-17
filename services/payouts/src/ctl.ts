// Operator commands for the payout loop. Same config and environment as main.ts.
//   npx tsx services/payouts/src/ctl.ts kill "why"        kill switch: block every send now (the running loop included)
//   npx tsx services/payouts/src/ctl.ts resume            release it
//   npx tsx services/payouts/src/ctl.ts status            kill switch, pause, ledger, funding, market phase
//   npx tsx services/payouts/src/ctl.ts sold PRL <coins> (--usd <n> | --sol <n>) [note]
//        record a sale of mined coin whose proceeds (SOL) are in the payout wallet: pays held-back
//        mining at the price it actually sold for
//   npx tsx services/payouts/src/ctl.ts handover-rate-authority <multisig> --yes
//        move the tax-rate authority from the payout wallet to the multisig (after graduation)
import { existsSync, readFileSync } from "node:fs";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { AuthorityType, createSetAuthorityInstruction, getMint, getTransferFeeConfig, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { guardSends, MeteoraMarket, monitoredConnection } from "@hashcoin/chain";
import { dataPath, loadRuntime, readKeypair, REPO_ROOT } from "./config.js";
import { engageKill, killReason, pauseFile, releaseKill } from "./control.js";
import { loadLedger, saveLedger } from "./ledger.js";
import { solUsd } from "./price.js";

const rt = loadRuntime();
const [cmd, ...args] = process.argv.slice(2);
const LEDGER = dataPath(rt, "ledger.json");
const conn = () => guardSends(monitoredConnection(rt.rpcUrl, () => {}), () => killReason(rt.dataDir, rt.envKill));
const signer = (): Keypair => {
  if (rt.keypairPath) return readKeypair(rt.keypairPath);
  const legacy = JSON.parse(readFileSync(`${REPO_ROOT}/packages/chain/data/devnet-keys.json`, "utf8")) as { treasury: number[] };
  return Keypair.fromSecretKey(Uint8Array.from(legacy.treasury));
};
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

switch (cmd) {
  case "kill": {
    const reason = args.join(" ").trim();
    engageKill(rt.dataDir, reason);
    console.log(`kill switch engaged (${dataPath(rt, "KILL")}). Every send from the payout loop is blocked, including a round in progress.`);
    break;
  }
  case "resume": {
    console.log(releaseKill(rt.dataDir) ? "kill switch released: the next round sends again." : "the kill switch wasn't engaged.");
    if (rt.envKill) console.log(`note: ${rt.envKill} is still set in the environment`);
    break;
  }
  case "status": {
    const l = loadLedger(LEDGER);
    console.log(`network ${rt.cfg.network}, data ${rt.dataDir}`);
    console.log(`kill switch: ${killReason(rt.dataDir, rt.envKill) ?? "off"}; pause: ${existsSync(pauseFile(rt.dataDir)) ? readFileSync(pauseFile(rt.dataDir), "utf8").trim() : "off"}`);
    if (!l) { console.log("no ledger yet"); break; }
    const c = conn();
    const me = signer().publicKey;
    console.log(`payout wallet ${me.toBase58()}: ${(await c.getBalance(me)) / LAMPORTS_PER_SOL} SOL`);
    console.log(`round ${l.round}, last ${l.lastRoundAt ? new Date(l.lastRoundAt).toISOString() : "never"}; ${l.owed.length} owed ($${l.owed.reduce((a, o) => a + o.usd, 0).toFixed(4)}); held back $${l.pending.reduce((a, p) => a + p.estimatedUsd, 0).toFixed(4)}`);
    const f = l.funding;
    console.log(`funding: curve fees claimed ${Number(BigInt(f.partnerFeesLamports)) / 1e9} SOL, pool fees ${Number(BigInt(f.poolFeesLamports)) / 1e9} SOL; buys ${f.buys.length}, ${Number(BigInt(f.spentLamports)) / 1e9} SOL → ${Number(BigInt(f.boughtTokens)) / 10 ** rt.cfg.decimals} $HASH; sale proceeds waiting $${f.saleBudgetUsd.toFixed(4)} (last ratio ${f.saleRatio})`);
    if (rt.cfg.market) {
      const m = new MeteoraMarket(c, { mint: new PublicKey(rt.cfg.market.mint), dbcConfig: new PublicKey(rt.cfg.market.dbcConfig) });
      const s = await m.state();
      console.log(`market: ${s.phase}, ${s.priceSol} SOL per $HASH, curve progress ${(100 * s.progress).toFixed(1)}%, unclaimed curve fee ${Number(s.partnerClaimableLamports) / 1e9} SOL`);
      const fee = getTransferFeeConfig(await getMint(c, new PublicKey(rt.cfg.market.mint), "confirmed", TOKEN_2022_PROGRAM_ID));
      const who = (k: PublicKey | null) => (!k ? "none" : k.equals(me) ? "payout wallet" : rt.multisig && k.equals(rt.multisig) ? "multisig" : k.toBase58());
      console.log(`authorities: tax rate ${who(fee?.transferFeeConfigAuthority ?? null)}, tax withdraw ${who(fee?.withdrawWithheldAuthority ?? null)}`);
    }
    break;
  }
  case "sold": {
    const [coin, coinsStr] = args;
    const coins = Number(coinsStr);
    if (!coin || !(coins > 0)) throw new Error("usage: sold <COIN> <coins sold> (--usd <proceeds> | --sol <proceeds>) [note]");
    const usdArg = flag("--usd"), solArg = flag("--sol");
    const usd = usdArg ? Number(usdArg) : solArg ? Number(solArg) * (await solUsd(rt.cfg.solUsd)).usd : NaN;
    if (!(usd > 0)) throw new Error("give the proceeds with --usd or --sol");
    const l = loadLedger(LEDGER);
    if (!l) throw new Error("no ledger yet");
    const unsold = l.funding.unsold?.[coin];
    if (!unsold || !(unsold.coins > 0)) throw new Error(`no unsold ${coin} on record (the collector records what it credits)`);
    const estimatedUsd = (unsold.usd / unsold.coins) * coins;
    const ratio = usd / estimatedUsd;
    const share = Math.min(1, coins / unsold.coins);
    unsold.coins -= unsold.coins * share;
    unsold.usd -= unsold.usd * share;
    const note = args.filter((a, i) => i > 1 && !a.startsWith("--") && !["--usd", "--sol"].includes(args[i - 1]!)).join(" ") || undefined;
    l.funding.saleBudgetUsd += usd;
    l.funding.saleRatio = ratio;
    l.funding.sales.push({ at: Date.now(), coin, coins, usd, ratio, ...(note ? { note } : {}) });
    saveLedger(LEDGER, l);
    console.log(`recorded: ${coins} ${coin} sold for $${usd.toFixed(2)} (estimated $${estimatedUsd.toFixed(2)}, ratio ${ratio.toFixed(3)}). Held-back mining is paid from it over the next rounds; keep the SOL in the payout wallet.`);
    break;
  }
  case "handover-rate-authority": {
    const to = new PublicKey(args[0] ?? "");
    if (!args.includes("--yes")) throw new Error(`this moves the tax-rate authority of ${rt.cfg.market?.mint} to ${to.toBase58()} for good (only that key can move it back). Re-run with --yes.`);
    if (!rt.cfg.market) throw new Error("no market in the config");
    const c = conn();
    const me = signer();
    const mint = new PublicKey(rt.cfg.market.mint);
    const cur = getTransferFeeConfig(await getMint(c, mint, "confirmed", TOKEN_2022_PROGRAM_ID))?.transferFeeConfigAuthority;
    if (!cur?.equals(me.publicKey)) throw new Error(`the payout wallet doesn't hold the tax-rate authority (it's ${cur?.toBase58() ?? "none"})`);
    const sig = await sendAndConfirmTransaction(c, new Transaction().add(createSetAuthorityInstruction(mint, me.publicKey, AuthorityType.TransferFeeConfig, to, [], TOKEN_2022_PROGRAM_ID)), [me]);
    console.log(`tax-rate authority → ${to.toBase58()}: ${sig}. The loop now writes rate changes as proposals for it (set HASH_MULTISIG=${to.toBase58()}).`);
    break;
  }
  default:
    console.log("commands: kill [why] | resume | status | sold <COIN> <coins> (--usd n | --sol n) [note] | handover-rate-authority <multisig> --yes");
    process.exitCode = cmd ? 1 : 0;
}
