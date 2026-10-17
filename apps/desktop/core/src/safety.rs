//! When to pause mining: a card running hot, the user at the PC ("mine only when idle"), or a game
//! running fullscreen. The shell measures; this decides, so it can be tested anywhere.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq)]
pub struct SafetySettings {
    /// Pause a card at this temperature (°C)...
    pub temp_limit_c: u32,
    /// ...and resume once it has cooled to this.
    pub temp_resume_c: u32,
    /// Mine only while nobody uses the keyboard or mouse.
    pub only_when_idle: bool,
    /// How long without input counts as idle.
    pub idle_after: Duration,
    /// Pause while a game (or any app) runs fullscreen.
    pub pause_when_fullscreen: bool,
}

impl Default for SafetySettings {
    fn default() -> Self {
        Self { temp_limit_c: 83, temp_resume_c: 75, only_when_idle: false, idle_after: Duration::from_secs(300), pause_when_fullscreen: false }
    }
}

/// What the shell measured this tick.
#[derive(Debug, Clone, Default)]
pub struct Readings {
    /// Time since the last keyboard or mouse input. None when unknown (never pauses).
    pub idle: Option<Duration>,
    pub fullscreen: bool,
    /// Temperature per GPU slot, where the app can read it (NVIDIA, through NVML).
    pub temps: HashMap<u32, u32>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Pause {
    Hot { temp_c: u32, resume_c: u32 },
    Fullscreen,
    InUse,
}

impl Pause {
    pub fn describe(&self) -> String {
        match self {
            Pause::Hot { temp_c, resume_c } => format!("Paused at {temp_c} °C, resumes at {resume_c} °C"),
            Pause::Fullscreen => "Paused while a game is fullscreen".into(),
            Pause::InUse => "Paused while you use the PC".into(),
        }
    }
}

/// When the miner already pauses hot cards itself (ForgeMiner's --temp-limit), the app only steps in
/// this many degrees above the limit, as a backstop. Otherwise both would fight over the same card.
pub const BACKSTOP_MARGIN_C: u32 = 4;

/// After a fullscreen game closes, wait this long before mining again, so alt-tabbing out of a game
/// doesn't restart the miners.
pub const FULLSCREEN_GRACE: Duration = Duration::from_secs(20);

#[derive(Debug, Default)]
pub struct Guard {
    hot: HashSet<u32>,
    last_temp: HashMap<u32, u32>,
    fullscreen_until: Option<Instant>,
    in_use: bool,
}

impl Guard {
    /// Take this tick's readings. `miner_pauses_hot(slot)` says whether the miner running on that
    /// slot has its own temperature limit.
    pub fn update(&mut self, s: &SafetySettings, r: &Readings, miner_pauses_hot: impl Fn(u32) -> bool, now: Instant) {
        for (&slot, &t) in &r.temps {
            self.last_temp.insert(slot, t);
            let limit = s.temp_limit_c + if miner_pauses_hot(slot) { BACKSTOP_MARGIN_C } else { 0 };
            if t >= limit {
                self.hot.insert(slot);
            } else if t <= s.temp_resume_c {
                self.hot.remove(&slot);
            }
        }
        if s.pause_when_fullscreen && r.fullscreen {
            self.fullscreen_until = Some(now + FULLSCREEN_GRACE);
        } else if !s.pause_when_fullscreen || self.fullscreen_until.is_some_and(|t| now >= t) {
            self.fullscreen_until = None;
        }
        self.in_use = s.only_when_idle && r.idle.is_some_and(|d| d < s.idle_after);
    }

    /// Why this GPU should not mine right now, if it shouldn't. A hot card comes first.
    pub fn pause_for(&self, slot: u32, s: &SafetySettings) -> Option<Pause> {
        if self.hot.contains(&slot) {
            return Some(Pause::Hot { temp_c: self.last_temp.get(&slot).copied().unwrap_or(s.temp_limit_c), resume_c: s.temp_resume_c });
        }
        if self.fullscreen_until.is_some() { return Some(Pause::Fullscreen); }
        if self.in_use { return Some(Pause::InUse); }
        None
    }

    /// The last temperature read for a slot.
    pub fn temp(&self, slot: u32) -> Option<u32> { self.last_temp.get(&slot).copied() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temps(t: &[(u32, u32)]) -> Readings { Readings { temps: t.iter().copied().collect(), ..Default::default() } }

    #[test]
    fn pauses_a_hot_card_until_it_cools() {
        let s = SafetySettings::default();
        let (mut g, now) = (Guard::default(), Instant::now());
        g.update(&s, &temps(&[(0, 82), (1, 70)]), |_| false, now);
        assert_eq!(g.pause_for(0, &s), None);
        g.update(&s, &temps(&[(0, 83)]), |_| false, now);
        assert_eq!(g.pause_for(0, &s), Some(Pause::Hot { temp_c: 83, resume_c: 75 }));
        assert_eq!(g.pause_for(1, &s), None, "only the hot card pauses");
        g.update(&s, &temps(&[(0, 78)]), |_| false, now);
        assert!(g.pause_for(0, &s).is_some(), "stays paused until it reaches the resume temperature");
        g.update(&s, &temps(&[(0, 75)]), |_| false, now);
        assert_eq!(g.pause_for(0, &s), None);
    }

    #[test]
    fn only_backstops_a_miner_with_its_own_limit() {
        let s = SafetySettings::default();
        let mut g = Guard::default();
        g.update(&s, &temps(&[(0, 85)]), |_| true, Instant::now());
        assert_eq!(g.pause_for(0, &s), None, "the miner handles 83-86 itself");
        g.update(&s, &temps(&[(0, 87)]), |_| true, Instant::now());
        assert!(g.pause_for(0, &s).is_some());
    }

    #[test]
    fn mines_only_when_idle_if_asked() {
        let mut s = SafetySettings::default();
        let mut g = Guard::default();
        let busy = Readings { idle: Some(Duration::from_secs(10)), ..Default::default() };
        let away = Readings { idle: Some(Duration::from_secs(301)), ..Default::default() };
        g.update(&s, &busy, |_| false, Instant::now());
        assert_eq!(g.pause_for(0, &s), None, "off by default");
        s.only_when_idle = true;
        g.update(&s, &busy, |_| false, Instant::now());
        assert_eq!(g.pause_for(0, &s), Some(Pause::InUse));
        g.update(&s, &away, |_| false, Instant::now());
        assert_eq!(g.pause_for(0, &s), None);
    }

    #[test]
    fn pauses_for_fullscreen_with_a_grace_period() {
        let s = SafetySettings { pause_when_fullscreen: true, ..Default::default() };
        let (mut g, t0) = (Guard::default(), Instant::now());
        let full = Readings { fullscreen: true, ..Default::default() };
        g.update(&s, &full, |_| false, t0);
        assert_eq!(g.pause_for(0, &s), Some(Pause::Fullscreen));
        g.update(&s, &Readings::default(), |_| false, t0 + Duration::from_secs(5));
        assert_eq!(g.pause_for(0, &s), Some(Pause::Fullscreen), "a quick alt-tab doesn't restart the miner");
        g.update(&s, &Readings::default(), |_| false, t0 + FULLSCREEN_GRACE);
        assert_eq!(g.pause_for(0, &s), None);
        // Turning the option off resumes at once.
        g.update(&s, &full, |_| false, t0);
        g.update(&SafetySettings::default(), &full, |_| false, t0);
        assert_eq!(g.pause_for(0, &s), None);
    }
}
