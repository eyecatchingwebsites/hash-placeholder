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

All inputs are assumptions. Edit `Params` in `hashsim.py`.
