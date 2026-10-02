"""$HASH agent-based simulation (stdlib only).

Daily steps. Traders generate volume that decays after launch hype; a fee on
that volume is split between the miner chest, buyback-and-burn, and creator.
Miners are agents (home GPUs and rented 5090s) that join and leave based on
profit. Chest weights combine GPU balancing (earnings ** alpha), holding time,
and a minimum $hash stake.

All dollar inputs are scenario assumptions, not forecasts.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import statistics
from dataclasses import dataclass, field, asdict, replace
from pathlib import Path

# Baseline PRL revenue per GPU per day (user's figures; 4060/4090 interpolated)
# and power cost per day at $0.15/kWh.
GPU_TIERS = {
    #          revenue, power $/day, share of home miners
    "3060L": (1.20, 0.30, 0.20),
    "4060": (2.00, 0.40, 0.30),
    "4070": (3.00, 0.70, 0.25),
    "4090": (6.00, 1.60, 0.15),
    "5090": (10.00, 2.10, 0.10),
}


@dataclass
class Params:
    days: int = 90
    seed: int = 1

    # Market
    start_mcap: float = 1_000_000
    supply: float = 1_000_000_000
    turnover0: float = 0.20          # day-1 volume / mcap
    turnover_floor: float = 0.03     # long-run volume / mcap
    hype_halflife: float = 10.0      # days for turnover excess to halve
    liquidity_ratio: float = 0.15    # pool depth (quote side) / mcap
    trader_drift: float = -0.004     # daily net trader flow / mcap (sell bias once hype fades)
    trader_noise: float = 0.03       # daily random net flow / mcap

    # Fee split (fractions of trade value)
    fee_chest: float = 0.030
    fee_burn: float = 0.015
    fee_creator: float = 0.005
    platform_buys_taxed: bool = False

    # Eligibility and weighting
    alpha: float = 0.5               # weight ~ earnings ** alpha (1 = linear, 0.5 = sqrt)
    hold_ramp_days: float = 14.0     # holding-time multiplier ramps 0.25 -> 1 over this
    hold_min_mult: float = 0.25
    min_stake_usd: float = 50.0      # must hold this much $hash (USD value) to be eligible
    wallet_cap: float = 0.05         # max share of chest per wallet (0 = off)

    # Home miners (recruited from traders/holders)
    home_pool: int = 600             # potential home miners at full hype
    home_join_rate: float = 0.08     # daily fraction of remaining pool that tries it
    home_quit_extra: float = 0.25    # quit if trailing 7d extra < this x baseline
    home_daily_sell_prob: float = 0.02  # chance per day a home miner cashes out
    home_buys_stake: bool = True

    # Renters (rented 5090s, profit-driven, sell everything daily)
    rent_cost_day: float = 12.0      # rented 5090 per day
    rent_rev_day: float = 10.0
    rent_hurdle: float = 1.5         # need expected profit/day per card above this
    rent_max_new_cards: int = 40     # max cards added per day
    rent_cards_per_wallet: int = 4
    renter_stays_days: int = 3       # renters re-evaluate after this


@dataclass
class Miner:
    kind: str
    rev: float
    cost: float
    joined: int
    hold_start: int
    hash_tokens: float = 0.0
    stake_ok: bool = False
    trailing: list = field(default_factory=list)
    cost_basis_usd: float = 0.0
    paid_usd: float = 0.0
    alive: bool = True


class Pool:
    """Constant-product AMM: quote reserve Q, token reserve T."""

    def __init__(self, mcap, supply, liquidity_ratio):
        price = mcap / supply
        self.Q = mcap * liquidity_ratio
        self.T = self.Q / price

    @property
    def price(self):
        return self.Q / self.T

    def buy(self, usd):
        if usd <= 0:
            return 0.0
        k = self.Q * self.T
        self.Q += usd
        out = self.T - k / self.Q
        self.T -= out
        return out

    def sell(self, tokens):
        if tokens <= 0:
            return 0.0
        k = self.Q * self.T
        self.T += tokens
        out = self.Q - k / self.T
        self.Q -= out
        return out


def hold_mult(p, age):
    if p.hold_ramp_days <= 0:
        return 1.0
    return p.hold_min_mult + (1 - p.hold_min_mult) * min(1.0, age / p.hold_ramp_days)


def run(p: Params):
    rng = random.Random(p.seed)
    pool = Pool(p.start_mcap, p.supply, p.liquidity_ratio)
    supply = p.supply
    burned = 0.0
    creator_usd = 0.0
    miners: list[Miner] = []
    home_recruited = 0
    tier_names = list(GPU_TIERS)
    tier_w = [GPU_TIERS[t][2] for t in tier_names]
    last_chest_per_weight = 0.0
    rows = []
    carry = 0.0
    fee_total = p.fee_chest + p.fee_burn + p.fee_creator

    for day in range(p.days):
        price = pool.price
        mcap = price * supply
        hype = (0.5 ** (day / p.hype_halflife))
        turnover = p.turnover_floor + (p.turnover0 - p.turnover_floor) * hype

        # --- recruit home miners
        remaining = max(0, int(p.home_pool * (0.3 + 0.7 * hype)) - home_recruited)
        joins = sum(1 for _ in range(remaining) if rng.random() < p.home_join_rate)
        for _ in range(joins):
            t = rng.choices(tier_names, tier_w)[0]
            rev, pw, _ = GPU_TIERS[t]
            m = Miner("home", rev, pw, day, day)
            miners.append(m)
            home_recruited += 1

        # --- renters: estimate per-card chest share from yesterday
        alive_r = [m for m in miners if m.alive and m.kind == "rent"]
        if last_chest_per_weight > 0:
            w_wallet = (p.rent_rev_day * p.rent_cards_per_wallet) ** p.alpha * p.hold_min_mult
            exp_share_card = last_chest_per_weight * w_wallet / p.rent_cards_per_wallet
            profit = p.rent_rev_day + exp_share_card - p.rent_cost_day
            if profit > p.rent_hurdle:
                n_wallets = max(1, min(p.rent_max_new_cards, int(profit * 4)) // p.rent_cards_per_wallet)
                for _ in range(n_wallets):
                    c = p.rent_cards_per_wallet
                    miners.append(Miner("rent", p.rent_rev_day * c, p.rent_cost_day * c, day, day))
        alive = [m for m in miners if m.alive]

        # --- minimum stake: miners buy in (renters too, then sell it on exit)
        stake_buys = 0.0
        for m in alive:
            if p.min_stake_usd > 0 and m.hash_tokens * price < p.min_stake_usd:
                need = p.min_stake_usd - m.hash_tokens * price
                if m.kind == "home" and not p.home_buys_stake and m.hash_tokens == 0:
                    continue
                usd = need * (1 + fee_total)
                got = pool.buy(need)
                m.hash_tokens += got
                m.cost_basis_usd += usd
                stake_buys += usd
            m.stake_ok = p.min_stake_usd <= 0 or m.hash_tokens * pool.price >= p.min_stake_usd * 0.999

        # --- trader flow and volume
        volume = mcap * turnover
        net = mcap * (p.trader_drift * (1 - hype) + rng.gauss(0, p.trader_noise) * (0.5 + hype))
        if net > 0:
            pool.buy(net)
        else:
            pool.sell(-net / pool.price)
        volume_all = volume + stake_buys
        fees = volume_all * fee_total
        chest_usd = volume_all * p.fee_chest + carry
        burn_usd = volume_all * p.fee_burn
        creator_usd += volume_all * p.fee_creator

        # --- miners' mined PRL converted to $hash (platform buy)
        mined_usd = sum(m.rev for m in alive)
        taxed = (1 - fee_total) if p.platform_buys_taxed else 1.0

        # --- burn
        b = pool.buy(burn_usd)
        burned += b
        supply -= b

        # --- weights
        weights = {}
        for m in alive:
            if not m.stake_ok:
                continue
            w = m.rev ** p.alpha * hold_mult(p, day - m.hold_start)
            weights[id(m)] = w
        W = sum(weights.values())
        shares = {}
        if W > 0:
            for k, w in weights.items():
                shares[k] = w / W
            if p.wallet_cap > 0:
                for _ in range(5):
                    over = {k: s for k, s in shares.items() if s > p.wallet_cap}
                    if not over:
                        break
                    excess = sum(s - p.wallet_cap for s in over.values())
                    under = {k: s for k, s in shares.items() if s < p.wallet_cap}
                    us = sum(under.values())
                    for k in over:
                        shares[k] = p.wallet_cap
                    for k in under:
                        shares[k] += excess * under[k] / us if us else 0
        last_chest_per_weight = chest_usd / W if W else chest_usd
        carry = chest_usd * (1 - sum(shares.values()))

        # --- pay out: buy $hash with mined PRL + chest share
        total_buy = mined_usd + chest_usd * sum(shares.values())
        px_before = pool.price
        tokens_out = pool.buy(total_buy * taxed)
        per_usd = tokens_out / total_buy if total_buy else 0
        home_extra_pct = []
        for m in alive:
            s = shares.get(id(m), 0.0)
            pay = m.rev + chest_usd * s
            m.hash_tokens += pay * per_usd
            m.paid_usd += pay
            m.cost_basis_usd += m.cost
            extra = chest_usd * s / m.rev
            m.trailing = (m.trailing + [extra])[-7:]
            if m.kind == "home":
                home_extra_pct.append(extra * 100)
        chest_to_renters = sum(chest_usd * shares.get(id(m), 0) for m in alive if m.kind == "rent")

        # --- exits / sells
        for m in alive:
            if m.kind == "rent":
                # renters sell all but stake daily; leave if unprofitable
                keep = p.min_stake_usd / pool.price if p.min_stake_usd > 0 else 0
                sell_t = max(0.0, m.hash_tokens - keep)
                pool.sell(sell_t * (1 - fee_total))
                m.hash_tokens -= sell_t
                if sell_t > 0:
                    m.hold_start = day  # selling resets holding time
                if day - m.joined >= p.renter_stays_days:
                    avg = statistics.mean(m.trailing) if m.trailing else 0
                    if m.rev * (1 + avg) < m.cost + p.rent_hurdle * (m.rev / p.rent_rev_day):
                        pool.sell(m.hash_tokens * (1 - fee_total))
                        m.hash_tokens = 0
                        m.alive = False
            else:
                avg = statistics.mean(m.trailing) if m.trailing else 0
                quit_ = (day - m.joined >= 7 and avg < p.home_quit_extra)
                cash = rng.random() < p.home_daily_sell_prob
                if quit_ or cash:
                    pool.sell(m.hash_tokens * (1 - fee_total))
                    m.hash_tokens = 0
                    if quit_:
                        m.alive = False
                    else:
                        m.hold_start = day  # sold: holding clock resets (new wallet)

        home_alive = [m for m in miners if m.alive and m.kind == "home"]
        rent_alive = [m for m in miners if m.alive and m.kind == "rent"]
        rows.append({
            "day": day + 1,
            "price_x": round(pool.price / (p.start_mcap / p.supply), 4),
            "mcap": round(pool.price * supply),
            "volume": round(volume_all),
            "chest": round(chest_usd),
            "burn_usd": round(burn_usd),
            "burned_pct": round(100 * burned / p.supply, 3),
            "home_miners": len(home_alive),
            "rent_cards": sum(int(m.rev / p.rent_rev_day) for m in rent_alive),
            "renter_chest_pct": round(100 * chest_to_renters / chest_usd, 1) if chest_usd else 0,
            "home_extra_median_pct": round(statistics.median(home_extra_pct), 1) if home_extra_pct else 0,
            "home_extra_p90_pct": round(sorted(home_extra_pct)[int(0.9 * (len(home_extra_pct) - 1))], 1) if home_extra_pct else 0,
            "creator_cum": round(creator_usd),
        })

    # outcome for home miners: value now (tokens marked at final price, after sell fee) + paid-out
    # cashouts are reflected in pool, so approximate with ROI vs keeping PRL.
    homes = [m for m in miners if m.kind == "home"]
    summary = {
        "final_price_x": rows[-1]["price_x"],
        "final_mcap": rows[-1]["mcap"],
        "burned_pct": rows[-1]["burned_pct"],
        "creator_total": rows[-1]["creator_cum"],
        "home_miners_ever": len(homes),
        "peak_rent_cards": max(r["rent_cards"] for r in rows),
        "median_extra_day7": rows[min(6, p.days - 1)]["home_extra_median_pct"],
        "median_extra_day30": rows[min(29, p.days - 1)]["home_extra_median_pct"],
        "median_extra_final": rows[-1]["home_extra_median_pct"],
        "avg_renter_chest_pct": round(statistics.mean(r["renter_chest_pct"] for r in rows), 1),
    }
    return rows, summary


SCENARIOS = {
    "original": dict(fee_chest=0.05, fee_burn=0.0, fee_creator=0.0, alpha=1.0,
                     hold_ramp_days=0, min_stake_usd=0, wallet_cap=0),
    "balanced": {},  # defaults: sqrt GPU balancing, 14d hold ramp, $50 stake, 5% cap, 3/1.5/0.5 split
    "balanced_no_burn": dict(fee_chest=0.045, fee_burn=0.0),
    "heavy_burn": dict(fee_chest=0.02, fee_burn=0.025),
    "stake_200": dict(min_stake_usd=200),
    "linear_weights": dict(alpha=1.0),
    "cheap_rentals": dict(rent_cost_day=10.5),
    "slow_hype": dict(hype_halflife=4, turnover0=0.12),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="all")
    ap.add_argument("--seeds", type=int, default=20)
    ap.add_argument("--out", default="sim/out")
    ap.add_argument("--set", nargs="*", default=[], help="override params, e.g. min_stake_usd=100")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    overrides = {}
    for kv in a.set:
        k, v = kv.split("=", 1)
        overrides[k] = json.loads(v) if v not in ("True", "False") else v == "True"
    names = list(SCENARIOS) if a.scenario == "all" else [a.scenario]

    table = []
    for name in names:
        base = replace(Params(), **SCENARIOS[name], **overrides)
        sums = []
        for s in range(a.seeds):
            rows, summ = run(replace(base, seed=s + 1))
            sums.append(summ)
            if s == 0:
                with open(out / f"{name}.csv", "w", newline="") as f:
                    w = csv.DictWriter(f, fieldnames=list(rows[0]))
                    w.writeheader()
                    w.writerows(rows)
        med = {k: round(statistics.median(x[k] for x in sums), 2) for k in sums[0]}
        med["scenario"] = name
        table.append(med)

    cols = ["scenario", "median_extra_day7", "median_extra_day30", "median_extra_final",
            "avg_renter_chest_pct", "peak_rent_cards", "home_miners_ever",
            "final_price_x", "burned_pct", "creator_total"]
    with open(out / "summary.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(table)
    print(" | ".join(cols))
    for r in table:
        print(" | ".join(str(r[c]) for c in cols))


if __name__ == "__main__":
    main()
