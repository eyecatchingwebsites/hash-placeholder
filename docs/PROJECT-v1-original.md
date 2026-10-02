# $HASH / Hashcoin: Project File

Last updated: October 1, 2026. Stage: idea and modeling. All market numbers below are scenario assumptions, not forecasts. Not financial or legal advice.

Interactive calculator: https://claude.ai/artifact/Rbyba6HTDEKgoiFfp91DRp

---

## 1. Summary

$HASH is a memecoin plus mining platform ("Earn more with GPU mining"). Users mine the most profitable GPU coin (for example PRL/Pearl) through the Hashcoin platform. Their mined coin and a share of a trading-fee payout chest are converted to $hash and sent back to them. The pitch is that miners earn more than they would mining on their own, and that miner growth pushes volume, price, and the chest up. The stated ambition is a roughly $100M market cap platform.

---

## 2. How it works

**Miner side**
1. A user mines the most profitable coin on their GPU (example: PRL) and points the miner at the platform's pool / hash wallet.
2. The platform records each miner's contributed revenue.
3. The mined coin is converted to $hash (buy pressure) and sent back to the miner.

**Fee side**
1. A 5% creator fee applies to $hash transactions.
2. Fees go into a payout chest.
3. The chest is split among eligible miners, weighted by top earners, and paid fully in $hash (the chest is converted to $hash before payout).

**Eligibility rule**
- Selling $hash makes that wallet ineligible for extra payouts. The intent is to discourage selling and let the chest grow.

**Creator revenue (under consideration)**
- Taking about 1% of the chest as creator revenue.

**Thesis**
- Mining plus creator-fee payouts are both hype narratives, and easy PC mining lowers the barrier.
- New miners receive $hash and don't want to sell (they'd lose eligibility), so price rises, volume rises, the chest grows, and more miners join.
- Similar creator-fee payout coins have run recently.

---

## 3. Scenario assumptions (user's)

| Input | Value |
|---|---|
| Market cap | $1M |
| 24h volume | $200K (1/5 of market cap) |
| Creator fee | 5% |
| Holders | ~1,000 (about $1K of market cap per holder, observed) |
| Share of wallets mining | 1 in 2 (~500 miners). Earlier assumption was 1 in 5 (~200) |
| Baseline mining revenue per miner | ~$2/day (PRL on an RTX 4060, user's current figure) |
| Volume added per miner | ~$2/day (their own PRL conversion only) |
| Chest weighting | Top earners weighted higher |

---

## 4. The model

**Formulas** (fee `f` in percent, base volume `V0`, miners `N`, volume added per miner `a`, baseline revenue per miner `R`)

- Total volume = V0 + a × N
- Chest per day = f% × total volume
- Extra per miner per day = chest ÷ N (equal split assumed)
- Extra % = f × (V0 ÷ N + a) ÷ R
- Net extra % (after one buy fee and one sell fee) = Extra % minus 2f
- Break-even vs just keeping the mined coin: V0 ÷ N + a ≥ 2R (the fee cancels out)

**Base scenario output**
- Chest: about $10K/day, roughly 1% of market cap per day.
- Per miner: about $20/day extra on $2 baseline, so about 1,000% extra (10x).
- Total payout per miner: about $22/day in $hash.
- Miner-generated buying: 500 × $2 = $1,000/day.

**Sensitivity: extra % (gross), 5% fee, $2 baseline, $2 volume added per miner**

| Base volume | 500 miners | 2,000 miners | 10,000 miners |
|---|---|---|---|
| $50K/day | 255% | 68% | 18% |
| $200K/day | 1,005% | 255% | 55% |
| $1M/day | 5,005% | 1,255% | 255% |

Subtract about 10 points for net after round-trip fees at a 5% fee.

**Break-even outside volume (V0 ≥ N × (2R minus a), at R = $2 and a = $2)**
- 500 miners: about $1K/day
- 2,000 miners: about $4K/day
- 10,000 miners: about $20K/day

**Price-path break-even.** A miner's accumulated $hash beats just holding the mined coin if average price retention is at least R ÷ (R + chest share per day).
- Base scenario ($20 share): retention of about 9% is enough (price can fall about 90%).
- A 55% extra case ($1.1 share): retention of about 65% is needed.
- The extra and the price tend to fall together, since volume follows price, so risk is highest when the extra is small. This ignores sell fees and the loss of eligibility on exit.

---

## 5. Creator revenue: 1% of the chest

Cut = 1% × fee × volume, which is 0.05% of daily volume at a 5% fee.

| Market cap | Daily volume | Chest/day | 1% per day | 30 days (volume held) |
|---|---|---|---|---|
| $1M | $50K (5%) | $2.5K | $25 | $750 |
| $1M | $200K (20%) | $10K | $100 | $3K |
| $10M | $1M (10%) | $50K | $500 | $15K |
| $10M | $2M (20%) | $100K | $1K | $30K |
| $100M | $5M (5%) | $250K | $2.5K | $75K |
| $100M | $20M (20%) | $1M | $10K | $300K |

Notes
- If volume halves each week, the 30-day total is about a third of the constant-volume figure.
- Figures are gross: pool infrastructure, swap slippage and gas, legal, and taxes come out first.
- Taking the cut in $hash and selling is visible on-chain and can hit the sell fee and price. Vesting or taking it in the quote asset are alternatives.
- Disclose the cut up front.

---

## 6. PRL (Pearl) notes: snapshots, will date quickly

- Pearl is an AI-compute / proof-of-useful-work coin whose mainnet launched in late April 2026. Mining is Nvidia-only (guides cite RTX 30-series or newer).
- Tom's Hardware reported a GPU mining rush with per-card returns already falling (an RTX 5090's daily revenue had halved since April). Much of the activity ran on rented cloud GPUs (RTX 4090/5090 via services like RunPod and Vast.ai).
- Bitrue's writeup notes PRL liquidity is relatively limited and flags speculative-cycle risk.
- Kryptex listing (July 2026): RTX 4060 about 50 TH/s on PearlHash at 110W, about $0.63/day profit then. The user's current figure is $2/day revenue. 110W is roughly $0.40/day of electricity at $0.15/kWh.
- Takeaway: the miner base is tied to a coin cycle that can fade, and revenue per card is volatile.

---

## 7. Risks and critique (discussed)

1. **Volume depends on the fee.** A 5% fee is about 10% round trip. Bots, snipers, and flippers tend to avoid taxed tokens, so the volume that funds the chest is the volume the fee suppresses. A 20% daily turnover also means traders pay about 1% of market cap per day, which is unlikely to last beyond the hype phase.
2. **Free entry competes the extra away.** A 10x return on a $2/day activity invites GPU rentals. Rough equilibrium: miners ≈ chest ÷ net cost to join. At $10K chest and $1/day net cost, that's about 10,000 miners and about $1 extra each.
3. **Weighting favors farms.** Top-earner weighting means one operator with many rented cards captures most of the chest.
4. **Lockout is bypassable.** Selling and rejoining with a new wallet avoids the penalty, so it is not a strong holder-retention mechanic.
5. **Miners' own flow doesn't create extra.** Their conversions are taxed too, and the fee returns to them roughly net zero. Real extra comes from outside traders.
6. **Miners swap a real asset for a volatile one,** at a fee on the way in and again on the way out. See price-path break-even above.
7. **Conversion costs.** Selling PRL (limited liquidity) and buying $hash (a $10K/day chest conversion is about 1% of a $1M market cap per day) both incur slippage, and may incur the 5% fee on the platform's own buys.
8. **Adoption realism.** Mining needs a recent Nvidia GPU. Wallets are not people (bots, snipers, multi-wallet traders). Earlier estimate was 1 in 5 mining, later 1 in 2.
9. **Operational build.** Pool, custody of mined coins, per-miner accounting, auto-switching if the most profitable coin changes, swap routing, payouts.
10. **Trust and security.** Users are wary of downloading mining software from a memecoin. Use open-source miners, a transparent dashboard, and ideally an audit.
11. **Legal and regulatory.** "Earn more" marketing plus payouts funded by other participants' fees and weighted splits can resemble profit sharing. Holding user funds adds custody questions. Review with a crypto lawyer before launch; do not promise returns.
12. **Base rates.** Most memecoins never pass a few million market cap, and the creator-fee coins that ran are the survivors.

Where the model is stronger than it looks: breaking even against just holding PRL only needs modest outside volume (about $1K/day for 500 miners). The upside depends on sustained volume and price.

---

## 8. Design changes discussed

- Lower the fee to 1-2%, or fund part of the chest from mining revenue.
- Weight payouts by holding time and cap per-wallet share (or use a square-root curve) to blunt farms and sybils.
- Public on-chain accounting and a live dashboard.
- Run per-card unit economics before claiming anything (real PRL revenue minus electricity).
- Frame it as a mining-rewards experiment, not guaranteed income.

---

## 9. Open decisions

- Chain and launchpad, and how the 5% fee is actually implemented.
- Which coin(s) miners mine and how switching works.
- Whether the platform's own conversion buys are subject to the fee.
- Weighting formula and cap for the chest split.
- Payout cadence and vesting.
- Whether to take a creator cut, how large, in what asset, and how it is disclosed.
- Legal structure and custody approach.

---

## 10. Discussion timeline

1. Idea laid out; initial critique of mechanics, volume dependence, trust, and legal risk.
2. Calculator built (fee, volume, miners, baseline revenue).
3. Clarified that mined PRL and chest share are converted to $hash and returned.
4. Reviewed PRL as the mined coin, current profitability and risks.
5. Updated calculator: base volume vs volume added per miner, net after fees.
6. Scenario work: 1M market cap, 200K volume, ~500 miners, about 1,000% extra, and what breaks it.
7. Creator-cut take-home estimates at different market caps and volumes.
