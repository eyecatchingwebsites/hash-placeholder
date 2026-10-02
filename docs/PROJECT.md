# $HASH / Hashcoin: Project File (v2)

Last updated: October 2, 2026. Stage: design + simulation. Numbers are scenario assumptions, not forecasts. Not financial or legal advice.
Original v1 notes: `docs/PROJECT-v1-original.md`. Simulation: `sim/` (see `sim/README.md`).

## 1. Summary
A memecoin plus GPU-mining platform aimed at **memecoin traders with gaming PCs**. Users mine through the platform, and their mined coin is sold to buy $HASH, which is paid back to them. A 5% trading fee funds a payout chest, a buyback-and-burn, and the creator. Chest share depends on GPU earnings (sqrt-balanced) and the miner's **level**.

## 2. Fee (5% per trade)
| Share | Use |
|---|---|
| 3.0% | Chest: converted to $HASH, split among miners |
| 1.5% | Buyback and burn |
| 0.5% | Creator (disclosed up front) |

The $UPLIFT platform reportedly ran a 5% fee. Copy its implementation details (whether the fee applies to plain transfers, exemptions for platform buys, chain and contract type).

## 3. Levels
| Level | Requirement | Chest weight |
|---|---|---|
| 1 | Mining (default) | 1× |
| 2 | $HASH position ≥ $50 | 2× |
| 3 | Position ≥ $500 **and** ≥ 14 days since $HASH first landed in the wallet **and** the wallet has never sold | 4× |

Rules:
- **Weight** = (GPU USD earnings)^0.5 × level multiplier. Each wallet is capped at 5% of the chest.
- **The 14-day clock** starts the first time $HASH lands in the wallet (a mining payout or a buy). It keeps running through dips.
- **Downgrades:**
  - L2 → L1 when the position is below $50.
  - L3 → L2 when the position is below $500. Getting back above $500 restores L3 immediately, with no new 14-day wait.
- **Selling at any time permanently disqualifies the wallet from L3.** It can still be L1 or L2 based on its position.
- **Transfers out count as selling.** That includes wallet-to-wallet moves, LP deposits, and CEX deposits. Buying more never counts.
- **Mined $HASH counts toward thresholds,** so miners level up by holding what they earn.
- **Price for thresholds:** use a ~1-hour average price, checked at each payout, so one price wick doesn't mass-downgrade holders.
- **Advertised payouts per level** are shown as "paid in the last 24h," never as promises. Percentages depend on volume and miner count. Only the ratios (1:2:4) are fixed.
- **Possible perks for L3:** 100% instant payout (lower float risk), a vote on which coins auto-switching may use, and a badge or role.

## 4. Payouts
- **Credit by shares.** Shares are validated by the pool instantly and can't be faked. No block confirmations are needed to credit a miner.
- **Hybrid payout:** ~75% of estimated mining earnings paid in $HASH every ~10 min from a float, and the rest after the coin confirms and sells (trued up to the actual sale price). The chest is already in SOL, so it can be paid hourly.
- **Float:** about 1–2× miner revenue over the confirmation window (≈$1K at 500 miners).
- **Wait for confirmations on:** stake deposits (Solana `finalized`), anything users send the platform, and float top-ups (confirmed sales only).
- **Watch for block withholding** (expected vs actual blocks per pool, and large wallets that submit shares but never land a block).
- **Dashboard** shows "Paid" and "Pending confirmation" balances, plus level progress bars.

## 5. Mining and auto-switching
- **One coin for everyone, chosen centrally** and re-checked every few hours. Switch only when the gain is more than 10–15% and sustained. Candidates: PRL, QUAN, QTC, EPIC (unverified).
- **Score coins by revenue you can actually sell:** revenue × price − slippage at platform sell volume − confirmation-delay risk.
- **Weights are in USD earnings,** so different algorithms compare fairly.
- **Minimum version:** an existing pool with per-worker stats, with worker name = user wallet.
- **Open-source miner, published checksums, VirusTotal link.**

## 6. Website
- **For traders:** "The memecoin your GPU mines." Live GPUs online, $HASH bought by miners, supply burned, chest paid. Buy-pressure explanation, proof links (Solscan, the pool's public page, the repo), the tokenomics box. Contract address shown only at launch.
- **For miners:** "Mine with your gaming PC. Get paid in $HASH every 10 minutes." A calculator of what a GPU like yours earned yesterday (including level bonuses), 3-step setup, a level explainer, safety, and the catch stated honestly.

## 7. Pre-launch
- No paid SOL beta.
- Proof:
  - One unedited video: install → first payout with a Solscan link.
  - A small free test with people you know.
  - An open-source repo.
  - A devnet demo of the chest, burn and levels.
- Hype:
  - A "register your GPU" waitlist with a live counter.
  - A visual of the full loop.
  - An illustrative calculator (clearly labeled).
  - GPU and gamer memes.
- **No token promises to early users, and no return claims.**

## 8. Simulation findings (90 days, 10 seeds, median)
| Design | Typical miner extra d7 / d30 / d90 | L1 / L2 / L3 extra d30 | Renters' share of chest | Price d90 |
|---|---|---|---|---|
| Original (5% chest, linear) | 188% / 59% / 25% | – | 37% | 0.17× |
| Balanced (hold ramp + $50 stake) | 410% / 279% / 44% | – | 7% | 0.20× |
| **Levels 1/2/4** | 862% / 157% / 59% | 77% / 153% / 250% | 16% | 0.40× |
| Levels 1/3/6 | 887% / 178% / 71% | 52% / 159% / 277% | 14% | 0.43× |

Takeaways:
- **Levels roughly double the price outcome** compared with the balanced design, because buying in to reach L3 adds demand.
- **Renters take ~16%** because $50 buys them L2 (2×) immediately. A higher L2 threshold, or L2 also needing a few days of wallet age, would cut that.
- **Early payouts are strong,** but they fall off as the hype fades, as in every design.
- **Model assumptions:**
  - 20% of home miners top up to $500 and 35% to $50.
  - Half of the miners who sell start a fresh wallet.

## 9. Open decisions
- Chain and launchpad, and how the fee is implemented.
- L2 threshold and/or minimum wallet age (to reduce renter capture).
- Whether to take partial profits above $500 without losing L3 (current rule: no).
- Float size and the immediate payout share.
- Legal review (payouts funded by other people's fees, custody, marketing language).
