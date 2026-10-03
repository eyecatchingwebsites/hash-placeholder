use crate::signed::Assignment;

/// What the app should do for one GPU after a check-in.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Same coin and pool as now: keep the miner running.
    Keep,
    /// Start (or restart with) this assignment.
    Run(Assignment),
    /// Nothing valid to mine: stop this GPU.
    Stop(String),
}

/// Decide whether a new assignment needs a miner restart. Only the fields that change
/// the miner's command line matter; a refreshed expiry alone keeps it running.
pub fn plan(current: Option<&Assignment>, next: Result<Assignment, String>) -> Action {
    match (current, next) {
        (_, Err(why)) => Action::Stop(why),
        (Some(cur), Ok(n)) if cur.coin == n.coin && cur.algo == n.algo && cur.miner_id == n.miner_id && cur.pool == n.pool => Action::Keep,
        (_, Ok(n)) => Action::Run(n),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signed::PoolTarget;

    fn a(coin: &str, exp: u64) -> Assignment {
        Assignment {
            v: 1, rig_id: "pc".into(), wallet: "W".into(), gpu_index: 0, gpu: "g".into(), coin: coin.into(), algo: coin.into(),
            miner_id: "m".into(), pool: PoolTarget { url: "stratum+tcp://p:1".into(), user: "W.pc-0".into(), pass: "x".into() },
            expected_usd_per_day: 1.0, reason: String::new(), issued_at: 0, expires_at: exp,
        }
    }

    #[test]
    fn keeps_running_on_refresh_and_restarts_on_switch() {
        assert_eq!(plan(Some(&a("PRL", 1)), Ok(a("PRL", 2))), Action::Keep);
        assert_eq!(plan(Some(&a("PRL", 1)), Ok(a("QTC", 2))), Action::Run(a("QTC", 2)));
        assert_eq!(plan(None, Ok(a("PRL", 1))), Action::Run(a("PRL", 1)));
        assert!(matches!(plan(Some(&a("PRL", 1)), Err("bad signature".into())), Action::Stop(_)));
    }
}
