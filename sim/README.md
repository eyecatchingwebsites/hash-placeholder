# $HASH simulation

Agent-based daily simulation of the $HASH mining + fee-chest design. Pure Python, no dependencies.

```
python3 sim/hashsim.py                       # all scenarios, 20 seeds
python3 sim/hashsim.py --scenario balanced --set min_stake_usd=100 hold_ramp_days=21
```

Outputs `sim/out/summary.csv` (medians across seeds) and one daily CSV per scenario (seed 1).

## Model
- **Market:** constant-product pool (depth = 15% of mcap). Volume/mcap decays from 20% to 3% with a 10-day hype half-life. Trader net flow is noisy with a mild sell bias after hype.
- **Fee (5%):** split chest / buyback-burn / creator (default 3 / 1.5 / 0.5).
- **Home miners:** recruited from traders while hype lasts, with GPU tiers 3060L ($1.20) to 5090 ($10). They quit if their 7-day extra falls below 25% of baseline, and 2%/day cash out (which resets holding time).
- **Renters:** rented 5090s ($12/day cost, $10/day PRL). They join when the expected chest share clears a hurdle, sell daily (resetting holding time), and leave when it stops paying.
- **Weight:** `earnings^alpha × holding multiplier`. Requires a minimum $hash stake, and each wallet is capped at 5% of the chest.
- **Levels mode** (`levels` scenarios): `earnings^alpha × level multiplier`, where L1 = 1×, L2 (≥ $50) = 2×, and L3 (≥ $500, wallet age ≥ 14 days, never sold) = 4×. See `docs/PROJECT.md` §3.

- **Fee accounting** (`fee_in_tokens`, default on): the Token-2022 tax is withheld in $HASH, so chest payouts, burns and holder rewards are paid in tokens and create no market buy. Only miners' mined coins are bought on the market, and the dev share is sold for costs. Set `fee_in_tokens=False` for the original model, which treated every fee dollar as a market buy and overstated prices.
- **Dual mode** (`dual_5pct*` scenarios): 5% tax, 0.5% dev, chest rate between `chest_min` and `chest_max` set by the miner boost (chest paid ÷ mined USD) between `boost_lo` and `boost_hi`, moving at most `split_step` a day. The rest goes to a holder pot (`1 - holder_burn_frac`) and a burn. Holder levels H1–H3 by bag (`h_usd`) and a hold clock (`h_days`) that selling shrinks in proportion; miner levels M1–M3 by days mined (`m_days`), with M2 requiring H1 and M3 requiring H2. Non-mining holders are an aggregate holding `holders_value_frac` of mcap with value mix `holder_mix` and sell part of their rewards (`holder_sell_frac`).
- **Current design:** `current_3pct` (2.5% chest, 0.5% dev, levels 1/2/4).
- **Limits:** trader flow doesn't react to the tax rate or to holder rewards. Compare designs on miner income, holder pot and renter share; treat the price column as weak.

All inputs are assumptions. Edit `Params` in `hashsim.py`.
