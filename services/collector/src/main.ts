// Collector on its own: every few minutes, read the pool's per-worker stats and turn them into
// mining hours and mined value per wallet. The payout loop (services/payouts) runs this itself.
//   npx tsx services/collector/src/main.ts          run every `everyMinutes`
//   npx tsx services/collector/src/main.ts --once   one run, then exit
import { cfg, runCollector } from "./run.js";

await runCollector();
if (!process.argv.includes("--once")) setInterval(() => { runCollector().catch((e) => console.error(e)); }, cfg.everyMinutes * 60 * 1000);
