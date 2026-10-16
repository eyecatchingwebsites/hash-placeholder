//! Telling when antivirus (in practice Microsoft Defender) stopped the miner or the app, so the
//! window can explain it instead of showing a vague error. This only looks at what's visible from
//! here: a miner file that vanished or can't be read, a miner that died at once without output,
//! or the app itself killed while starting a miner. It never touches antivirus settings.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// What the miner's executable looks like on disk.
#[derive(Debug, Clone, PartialEq)]
pub enum ExeState {
    Ok,
    /// Gone after it was written (quarantined).
    Missing,
    /// There, but can't be opened or read (locked by the scanner or quarantine).
    Unreadable(String),
}

pub fn exe_state(path: &Path) -> ExeState {
    let mut buf = [0u8; 2];
    match File::open(path).and_then(|mut f| f.read_exact(&mut buf)) {
        Ok(()) => ExeState::Ok,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => ExeState::Missing,
        Err(e) => ExeState::Unreadable(e.to_string()),
    }
}

/// Windows errors that mean "something stopped this program from being run":
/// not found (2), access denied (5), "contains a virus" (225), blocked by policy (1260),
/// and STATUS_ACCESS_DENIED / STATUS_VIRUS_INFECTED as exit codes.
const BLOCKED_CODES: [i32; 6] = [2, 5, 225, 1260, 0xC000_0022_u32 as i32, 0xC000_0906_u32 as i32];

/// A miner that exits this soon without printing anything was most likely killed on sight.
pub const QUICK_EXIT: Duration = Duration::from_secs(20);

/// How one run of a miner ended (recorded by `miner::Supervisor`).
#[derive(Debug, Clone, PartialEq)]
pub struct ExitInfo {
    pub ran: Duration,
    pub code: Option<i32>,
    /// The miner printed something to its log before it ended.
    pub wrote_output: bool,
}

/// Why a miner run looks blocked, or None if it looks like an ordinary crash (those just restart).
pub fn exit_looks_blocked(info: &ExitInfo, exe: &ExeState) -> Option<String> {
    if let Some(why) = exe_blocked(exe) {
        return Some(why);
    }
    if info.ran >= QUICK_EXIT { return None; }
    if let Some(c) = info.code.filter(|c| BLOCKED_CODES.contains(c)) {
        return Some(format!("the miner was stopped as it started (exit code 0x{:08X})", c as u32));
    }
    (!info.wrote_output).then(|| format!("the miner closed after {:.0} s without any output", info.ran.as_secs_f64()))
}

/// Why the miner file looks quarantined, if it does.
pub fn exe_blocked(exe: &ExeState) -> Option<String> {
    match exe {
        ExeState::Ok => None,
        ExeState::Missing => Some("the miner file disappeared after it was downloaded".into()),
        ExeState::Unreadable(e) => Some(format!("the miner file can't be read ({e})")),
    }
}

/// Whether a failure to start a program (its OS error code) looks like it was blocked.
pub fn spawn_blocked(os_error: Option<i32>) -> bool {
    os_error.is_some_and(|c| BLOCKED_CODES.contains(&c))
}

/// A file that exists only while a miner is starting. If the app finds it at launch, the last
/// run was killed mid-start (or the PC lost power then), which is what Defender's kill looks like.
pub struct StartMarker(PathBuf);

impl StartMarker {
    pub fn new(path: PathBuf) -> Self { Self(path) }
    pub fn set(&self) { let _ = std::fs::write(&self.0, b""); }
    pub fn clear(&self) { let _ = std::fs::remove_file(&self.0); }
    pub fn is_set(&self) -> bool { self.0.exists() }
    /// At launch: was the last run killed while starting a miner? Clears the marker either way.
    pub fn left_over(&self) -> bool {
        let was = self.is_set();
        self.clear();
        was
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf { std::env::temp_dir().join(format!("hashcoin-blocked-{}-{name}", std::process::id())) }

    #[test]
    fn sees_a_vanished_miner() {
        let p = tmp("gone.exe");
        std::fs::write(&p, b"MZ...").unwrap();
        assert_eq!(exe_state(&p), ExeState::Ok);
        std::fs::remove_file(&p).unwrap(); // what quarantine does
        assert_eq!(exe_state(&p), ExeState::Missing);
        let quick = ExitInfo { ran: Duration::from_secs(600), code: Some(1), wrote_output: true };
        assert!(exit_looks_blocked(&quick, &exe_state(&p)).unwrap().contains("disappeared"));
    }

    #[test]
    fn sees_a_locked_miner() {
        let p = tmp("locked.exe");
        std::fs::write(&p, b"MZ...").unwrap();
        #[cfg(windows)]
        let _hold = {
            use std::os::windows::fs::OpenOptionsExt;
            // Opened with no sharing, as a scanner holding the file would.
            std::fs::OpenOptions::new().read(true).share_mode(0).open(&p).unwrap()
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o000)).unwrap();
        }
        let state = exe_state(&p);
        // (root can read anything, so on a root-run Unix CI this part can't be shown)
        if !matches!(state, ExeState::Ok) {
            assert!(matches!(state, ExeState::Unreadable(_)), "{state:?}");
            assert!(exe_blocked(&state).unwrap().contains("can't be read"));
        }
        #[cfg(windows)]
        drop(_hold);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn tells_a_kill_from_an_ordinary_crash() {
        let ok = ExeState::Ok;
        let silent = ExitInfo { ran: Duration::from_secs(2), code: Some(1), wrote_output: false };
        assert!(exit_looks_blocked(&silent, &ok).is_some(), "killed before printing anything");
        let denied = ExitInfo { ran: Duration::from_secs(3), code: Some(0xC000_0022_u32 as i32), wrote_output: true };
        assert!(exit_looks_blocked(&denied, &ok).unwrap().contains("0xC0000022"));
        let pool_error = ExitInfo { ran: Duration::from_secs(4), code: Some(1), wrote_output: true };
        assert_eq!(exit_looks_blocked(&pool_error, &ok), None, "a miner that said why it stopped just restarts");
        let late = ExitInfo { ran: Duration::from_secs(300), code: Some(5), wrote_output: false };
        assert_eq!(exit_looks_blocked(&late, &ok), None, "ran for minutes: a crash, not a block");
        assert!(spawn_blocked(Some(225)) && spawn_blocked(Some(5)) && !spawn_blocked(Some(8)) && !spawn_blocked(None));
    }

    #[test]
    fn start_marker_survives_only_a_killed_start() {
        let m = StartMarker::new(tmp("starting"));
        m.clear();
        assert!(!m.left_over());
        m.set(); // the app is killed before it can clear it
        assert!(m.left_over(), "found at the next launch");
        assert!(!m.is_set(), "and only reported once");
        m.set();
        m.clear(); // the miner got going, or the user stopped it
        assert!(!m.left_over());
    }
}
