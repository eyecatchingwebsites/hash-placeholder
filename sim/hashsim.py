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

    # Level system (replaces hold ramp + min stake when levels=True)
    levels: bool = False
    level_mults: tuple = (1.0, 2.0, 4.0)
    l2_usd: float = 50.0             # L2: position >= this
    l3_usd: float = 500.0            # L3: position >= this, never sold, wallet age >= l3_days
    l3_days: int = 14                # clock starts when $HASH first lands in the wallet
    home_target_probs: tuple = (0.45, 0.35, 0.20)  # home miners who top up to $0 / L2 / L3
    new_wallet_after_sell: float = 0.5  # chance a home miner who sells starts a fresh wallet

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

    # Fee accounting. True: the Token-2022 tax is withheld in $HASH, so the chest, burn and
    # holder rewards are paid in tokens (no market buy), and the dev share is sold for costs.
    # Only miners' mined coins become market buys. False: the original model, where every fee
    # dollar bought $HASH on the market (overstates buy pressure).
    fee_in_tokens: bool = True
    dev_sells_fee: bool = True

    # Dual ladders (miner levels M1-M3 + holder levels H1-H3) with a dynamic 5% split
    dual: bool = False
    tax_total: float = 0.05
    tax_dev: float = 0.005
    chest_min: float = 0.015         # chest share of volume at high miner boost
    chest_max: float = 0.045         # chest share of volume at low miner boost
    boost_lo: float = 3.0            # boost = chest paid / mined USD (trailing day)
    boost_hi: float = 10.0
    split_step: float = 0.01         # max change of the chest rate per day
    # Target mode (overrides boost_lo/hi): each day the chest takes exactly what lifts miners'
    # total pay to target_total_mult x what their GPUs mined, between chest_floor and chest_max.
    target_total_mult: float = 0.0   # 0 = off; 5 = miners get mining + 4x mining from the chest
    chest_floor: float = 0.0
    holder_burn_frac: float = 0.25   # part of the holder side that is burned
    h_usd: tuple = (50.0, 500.0, 2500.0)   # H1 / H2 / H3 bag (USD)
    h_days: tuple = (0.0, 1.0, 3.0)        # H1 / H2 / H3 hold clock (days); selling shrinks the clock
    h_mults: tuple = (1.0, 2.0, 4.0)
    m_days: tuple = (0, 2, 5)              # M1 / M2 / M3 days mined; M2 needs H1, M3 needs H2
    m_mults: tuple = (1.0, 2.0, 4.0)
    home_targets_dual: tuple = (0.0, 50.0, 500.0, 2500.0)
    home_target_probs_dual: tuple = (0.35, 0.35, 0.22, 0.08)
    # Holders who don't mine (aggregate): share of mcap they hold, value mix by holder level
    # (none / H1 / H2 / H3), and the part of their rewards they sell
    holders_value_frac: float = 0.60
    holder_mix: tuple = (0.15, 0.30, 0.35, 0.20)
    holder_sell_frac: tuple = (1.0, 0.6, 0.3, 0.1)


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
    first_hash_day: int = -1
    ever_sold: bool = False
    target_usd: float = 0.0
    level: int = 1
    clock: float = 0.0               # hold clock (days); selling shrinks it in proportion
    hlevel: int = 0                  # holder level 0-3 (dual mode)
    holder_paid_usd: float = 0.0


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


def holder_level(p, value, clock):
    lvl = 0
    for k in range(3):
        if value >= p.h_usd[k] and clock >= p.h_days[k]:
            lvl = k + 1
    return lvl


def miner_level(p, tenure, hlevel):
    if tenure >= p.m_days[2] and hlevel >= 2:
        return 3
    if tenure >= p.m_days[1] and hlevel >= 1:
        return 2
    return 1


def target_chest_rate(p, boost):
    if boost <= p.boost_lo:
        return p.chest_max
    if boost >= p.boost_hi:
        return p.chest_min
    t = (boost - p.boost_lo) / (p.boost_hi - p.boost_lo)
    return p.chest_max + t * (p.chest_min - p.chest_max)


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
    fee_total = p.tax_total if p.dual else p.fee_chest + p.fee_burn + p.fee_creator
    chest_rate = p.chest_max

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
            if p.dual:
                m.target_usd = rng.choices(list(p.home_targets_dual), p.home_target_probs_dual)[0]
            elif p.levels:
                m.target_usd = rng.choices([0.0, p.l2_usd, p.l3_usd], p.home_target_probs)[0]
            miners.append(m)
            home_recruited += 1

        # --- renters: estimate per-card chest share from yesterday
        if last_chest_per_weight > 0:
            if p.dual:
                rent_mult = p.m_mults[1]   # renters hold $50 for H1, so they can reach M2
            else:
                rent_mult = p.level_mults[1] if p.levels else p.hold_min_mult
            w_wallet = (p.rent_rev_day * p.rent_cards_per_wallet) ** p.alpha * rent_mult
            exp_share_card = last_chest_per_weight * w_wallet / p.rent_cards_per_wallet
            profit = p.rent_rev_day + exp_share_card - p.rent_cost_day
            if profit > p.rent_hurdle:
                n_wallets = max(1, min(p.rent_max_new_cards, int(profit * 4)) // p.rent_cards_per_wallet)
                for _ in range(n_wallets):
                    c = p.rent_cards_per_wallet
                    r = Miner("rent", p.rent_rev_day * c, p.rent_cost_day * c, day, day)
                    r.target_usd = p.l2_usd if not p.dual else p.h_usd[0]  # just enough for L2 / H1
                    miners.append(r)
        alive = [m for m in miners if m.alive]

        # --- hold clocks tick for anyone holding
        for m in alive:
            if m.hash_tokens > 0:
                m.clock += 1

        # --- stakes: miners buy up to their target (renters too, then sell it on exit)
        stake_buys = 0.0
        for m in alive:
            if p.levels or p.dual:
                need = m.target_usd - m.hash_tokens * pool.price
                if need > 1:
                    usd = need * (1 + fee_total)
                    m.hash_tokens += pool.buy(need)
                    m.cost_basis_usd += usd
                    stake_buys += usd
                    if m.first_hash_day < 0:
                        m.first_hash_day = day
                m.stake_ok = True
                continue
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

        # --- split the tax
        if p.dual and p.target_total_mult > 0:
            mined_now = sum(m.rev for m in alive)
            need = (p.target_total_mult - 1) * mined_now - carry
            chest_rate = max(p.chest_floor, min(p.chest_max, need / volume_all if volume_all else p.chest_max))
        if p.dual:
            chest_usd = volume_all * chest_rate + carry
            holder_side = volume_all * max(0.0, p.tax_total - p.tax_dev - chest_rate)
            burn_usd = holder_side * p.holder_burn_frac
            holder_pot = holder_side - burn_usd
            dev_usd = volume_all * p.tax_dev
        else:
            chest_usd = volume_all * p.fee_chest + carry
            burn_usd = volume_all * p.fee_burn
            holder_pot = 0.0
            dev_usd = volume_all * p.fee_creator
        creator_usd += dev_usd

        # --- burn and dev share
        if p.fee_in_tokens:
            # the tax is withheld in $HASH: burning destroys those tokens, no market buy
            b = burn_usd / pool.price
            if p.dev_sells_fee:
                pool.sell(dev_usd / pool.price)
        else:
            b = pool.buy(burn_usd)
        burned += b
        supply -= b

        # --- miner levels and weights
        mined_usd = sum(m.rev for m in alive)
        taxed = (1 - fee_total) if p.platform_buys_taxed else 1.0
        weights = {}
        for m in alive:
            if not m.stake_ok:
                continue
            val = m.hash_tokens * pool.price
            if p.dual:
                m.hlevel = holder_level(p, val, m.clock)
                m.level = miner_level(p, day - m.joined + 1, m.hlevel)
                w = m.rev ** p.alpha * p.m_mults[m.level - 1]
            elif p.levels:
                if (val >= p.l3_usd and not m.ever_sold and m.first_hash_day >= 0
                        and day - m.first_hash_day >= p.l3_days):
                    m.level = 3
                elif val >= p.l2_usd:
                    m.level = 2
                else:
                    m.level = 1
                w = m.rev ** p.alpha * p.level_mults[m.level - 1]
            else:
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
        paid_share = sum(shares.values())
        carry = chest_usd * (1 - paid_share)
        chest_paid = chest_usd * paid_share

        # --- pay out: mined coins become a market buy; the chest is paid in tax tokens
        if p.fee_in_tokens:
            tokens_mined = pool.buy(mined_usd * taxed)
            per_usd_mined = tokens_mined / mined_usd if mined_usd else 0
            per_usd_chest = 1 / pool.price
        else:
            total_buy = mined_usd + chest_paid
            tokens_out = pool.buy(total_buy * taxed)
            per_usd_mined = per_usd_chest = tokens_out / total_buy if total_buy else 0

        # --- holder pot (dual): split by bag x holder level; miners holding $HASH share it too
        holder_yield = {1: 0.0, 2: 0.0, 3: 0.0}
        holder_income = {}
        if p.dual and holder_pot > 0:
            agg_value = p.holders_value_frac * pool.price * supply
            agg_w = {k: agg_value * p.holder_mix[k] * p.h_mults[k - 1] for k in (1, 2, 3)}
            miner_w = {}
            for m in alive:
                if m.hlevel > 0:
                    miner_w[id(m)] = m.hash_tokens * pool.price * p.h_mults[m.hlevel - 1]
            HW = sum(agg_w.values()) + sum(miner_w.values())
            if HW > 0:
                for k in (1, 2, 3):
                    holder_yield[k] = holder_pot * p.h_mults[k - 1] / HW
                sold_usd = sum(holder_pot * agg_w[k] / HW * p.holder_sell_frac[k] for k in (1, 2, 3))
                pool.sell(sold_usd / pool.price)
                for m in alive:
                    if id(m) in miner_w:
                        usd = holder_pot * miner_w[id(m)] / HW
                        holder_income[id(m)] = usd
                        m.hash_tokens += usd / pool.price
                        m.holder_paid_usd += usd

        home_extra_pct = []
        lvl_extra = {1: [], 2: [], 3: []}
        for m in alive:
            s = shares.get(id(m), 0.0)
            pay = m.rev + chest_usd * s
            m.hash_tokens += m.rev * per_usd_mined + chest_usd * s * per_usd_chest
            if m.first_hash_day < 0:
                m.first_hash_day = day
            m.paid_usd += pay
            m.cost_basis_usd += m.cost
            extra = (chest_usd * s + holder_income.get(id(m), 0.0)) / m.rev
            m.trailing = (m.trailing + [extra])[-7:]
            if m.kind == "home":
                home_extra_pct.append(extra * 100)
                lvl_extra[m.level].append(extra * 100)
        chest_to_renters = sum(chest_usd * shares.get(id(m), 0) for m in alive if m.kind == "rent")

        # --- exits / sells
        for m in alive:
            if m.kind == "rent":
                # renters sell all but stake daily; leave if unprofitable
                stake_usd = (p.h_usd[0] if p.dual else p.min_stake_usd)
                keep = stake_usd / pool.price if stake_usd > 0 else 0
                held = m.hash_tokens
                sell_t = max(0.0, held - keep)
                pool.sell(sell_t * (1 - fee_total))
                m.hash_tokens -= sell_t
                if sell_t > 0:
                    m.hold_start = day  # selling resets holding time
                    m.ever_sold = True
                    m.clock *= (1 - sell_t / held) if held else 0
                if day - m.joined >= p.renter_stays_days:
                    avg = statistics.mean(m.trailing) if m.trailing else 0
                    if m.rev * (1 + avg) < m.cost + p.rent_hurdle * (m.rev / p.rent_rev_day):
                        pool.sell(m.hash_tokens * (1 - fee_total))
                        m.hash_tokens = 0
                        m.clock = 0
                        m.alive = False
            else:
                avg = statistics.mean(m.trailing) if m.trailing else 0
                quit_ = (day - m.joined >= 7 and avg < p.home_quit_extra)
                cash = rng.random() < p.home_daily_sell_prob
                if quit_ or cash:
                    pool.sell(m.hash_tokens * (1 - fee_total))
                    m.hash_tokens = 0
                    m.ever_sold = True
                    m.clock = 0
                    if quit_:
                        m.alive = False
                    else:
                        m.hold_start = day  # sold: holding clock resets (new wallet)
                        if p.levels and rng.random() < p.new_wallet_after_sell:
                            m.ever_sold = False
                            m.first_hash_day = -1

        # --- dynamic split: move the chest rate toward the target for today's boost
        boost = chest_paid / mined_usd if mined_usd else 0
        rate_today = chest_rate
        if p.dual and p.target_total_mult <= 0:
            tgt = target_chest_rate(p, boost)
            chest_rate += max(-p.split_step, min(p.split_step, tgt - chest_rate))

        home_alive = [m for m in miners if m.alive and m.kind == "home"]
        rent_alive = [m for m in miners if m.alive and m.kind == "rent"]
        rows.append({
            "day": day + 1,
            "price_x": round(pool.price / (p.start_mcap / p.supply), 4),
            "mcap": round(pool.price * supply),
            "volume": round(volume_all),
            "chest": round(chest_usd),
            "chest_rate_pct": round(100 * (rate_today if p.dual else p.fee_chest), 2),
            "boost_x": round(boost, 2),
            "holder_pot": round(holder_pot),
            **{f"H{k}_yield_pct_day": round(100 * holder_yield[k], 3) for k in (1, 2, 3)},
            "burn_usd": round(burn_usd),
            "burned_pct": round(100 * burned / p.supply, 3),
            "home_miners": len(home_alive),
            "rent_cards": sum(int(m.rev / p.rent_rev_day) for m in rent_alive),
            "renter_chest_pct": round(100 * chest_to_renters / chest_usd, 1) if chest_usd else 0,
            "home_extra_median_pct": round(statistics.median(home_extra_pct), 1) if home_extra_pct else 0,
            "home_extra_p90_pct": round(sorted(home_extra_pct)[int(0.9 * (len(home_extra_pct) - 1))], 1) if home_extra_pct else 0,
            "creator_cum": round(creator_usd),
            **{f"L{l}_home": len(v) for l, v in lvl_extra.items()},
            **{f"L{l}_extra_median_pct": round(statistics.median(v), 1) if v else 0
               for l, v in lvl_extra.items()},
        })

    homes = [m for m in miners if m.kind == "home"]
    d7, d30 = rows[min(6, p.days - 1)], rows[min(29, p.days - 1)]
    summary = {
        "final_price_x": rows[-1]["price_x"],
        "final_mcap": rows[-1]["mcap"],
        "burned_pct": rows[-1]["burned_pct"],
        "creator_total": rows[-1]["creator_cum"],
        "home_miners_ever": len(homes),
        "peak_rent_cards": max(r["rent_cards"] for r in rows),
        "median_extra_day7": d7["home_extra_median_pct"],
        "median_extra_day30": d30["home_extra_median_pct"],
        "median_extra_final": rows[-1]["home_extra_median_pct"],
        "avg_renter_chest_pct": round(statistics.mean(r["renter_chest_pct"] for r in rows), 1),
        "chest_rate_day7": d7["chest_rate_pct"],
        "chest_rate_day30": d30["chest_rate_pct"],
        "chest_rate_final": rows[-1]["chest_rate_pct"],
        "boost_day7": d7["boost_x"],
        "boost_day30": d30["boost_x"],
        "boost_final": rows[-1]["boost_x"],
        "days_at_target": sum(1 for r in rows if r["chest_rate_pct"] < 100 * p.chest_max - 1e-6) if p.dual else 0,
        "holder_pot_total": sum(r["holder_pot"] for r in rows),
        **{f"H{k}_yield_day7": d7[f"H{k}_yield_pct_day"] for k in (1, 2, 3)},
        **{f"H{k}_yield_day30": d30[f"H{k}_yield_pct_day"] for k in (1, 2, 3)},
        **{f"L{l}_extra_day30": d30[f"L{l}_extra_median_pct"] for l in (1, 2, 3)},
        **{f"L{l}_home_day30": d30[f"L{l}_home"] for l in (1, 2, 3)},
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
    # Level system: L1 free 1x, L2 >= $50 2x, L3 >= $500 + 14d + never sold 4x
    "levels": dict(levels=True, hold_ramp_days=0, min_stake_usd=0),
    "levels_1_3_6": dict(levels=True, hold_ramp_days=0, min_stake_usd=0, level_mults=(1.0, 3.0, 6.0)),
    "levels_few_l3": dict(levels=True, hold_ramp_days=0, min_stake_usd=0, home_target_probs=(0.6, 0.35, 0.05)),
    # Current design (Oct 3): fixed 3% = 2.5% chest + 0.5% dev, no burn, levels 1/2/4
    "current_3pct": dict(levels=True, hold_ramp_days=0, min_stake_usd=0,
                         fee_chest=0.025, fee_burn=0.0, fee_creator=0.005),
    # Proposal: 5% tax, dev 0.5%, chest 1.5-4.5% set by miner boost, rest to holders (75%) and burn (25%),
    # miner levels M1-M3 (days mined, gated by H1/H2) + holder levels H1-H3
    "dual_5pct": dict(dual=True, hold_ramp_days=0, min_stake_usd=0),
    # Same, if a 5% tax cuts trading volume by 30% versus 3%
    "dual_5pct_vol70": dict(dual=True, hold_ramp_days=0, min_stake_usd=0,
                            turnover0=0.14, turnover_floor=0.021),
    # Same, with lower boost thresholds so holders get a real share after the hype week
    "dual_5pct_lowboost": dict(dual=True, hold_ramp_days=0, min_stake_usd=0, boost_lo=0.5, boost_hi=2.0),
    "dual_5pct_lowboost_vol70": dict(dual=True, hold_ramp_days=0, min_stake_usd=0, boost_lo=0.5, boost_hi=2.0,
                                     turnover0=0.14, turnover_floor=0.021),
    # Same as lowboost, but miners buy in exactly like current_3pct ($0 / $50 / $500 with 45/35/20%),
    # so the price comparison isn't driven by a different buy-in assumption
    "dual_5pct_lowboost_samebuyin": dict(dual=True, hold_ramp_days=0, min_stake_usd=0, boost_lo=0.5, boost_hi=2.0,
                                         home_target_probs_dual=(0.45, 0.35, 0.20, 0.0)),
    # Target mode (user decision Oct 3): no burn, chest set each day so miners' total pay = N x mining
    "dual_target3x": dict(dual=True, hold_ramp_days=0, min_stake_usd=0, holder_burn_frac=0.0,
                          target_total_mult=3.0, home_target_probs_dual=(0.45, 0.35, 0.20, 0.0)),
    "dual_target5x": dict(dual=True, hold_ramp_days=0, min_stake_usd=0, holder_burn_frac=0.0,
                          target_total_mult=5.0, home_target_probs_dual=(0.45, 0.35, 0.20, 0.0)),
    "dual_target8x": dict(dual=True, hold_ramp_days=0, min_stake_usd=0, holder_burn_frac=0.0,
                          target_total_mult=8.0, home_target_probs_dual=(0.45, 0.35, 0.20, 0.0)),
    "dual_target5x_vol70": dict(dual=True, hold_ramp_days=0, min_stake_usd=0, holder_burn_frac=0.0,
                                target_total_mult=5.0, home_target_probs_dual=(0.45, 0.35, 0.20, 0.0),
                                turnover0=0.14, turnover_floor=0.021),
    # Same, with all of the holder side going to holder rewards (no burn)
    "dual_5pct_noburn": dict(dual=True, hold_ramp_days=0, min_stake_usd=0, holder_burn_frac=0.0),
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
            "L1_extra_day30", "L2_extra_day30", "L3_extra_day30",
            "L1_home_day30", "L2_home_day30", "L3_home_day30", "avg_renter_chest_pct", "peak_rent_cards", "home_miners_ever",
            "chest_rate_day7", "chest_rate_day30", "chest_rate_final", "boost_day7", "boost_day30", "boost_final",
            "days_at_target", "holder_pot_total",
            "H1_yield_day7", "H2_yield_day7", "H3_yield_day7", "H1_yield_day30", "H2_yield_day30", "H3_yield_day30",
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
