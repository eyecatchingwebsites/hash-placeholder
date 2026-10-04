use crate::signed::Assignment;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Fill the manifest's argument template. Arguments are passed as an array (no shell),
/// and each value is checked so a bad assignment can't smuggle in extra flags.
pub fn render_args(template: &[String], a: &Assignment, device: u32, api_port: u16) -> Result<Vec<String>, String> {
    let safe = |s: &str, what: &str| -> Result<String, String> {
        if s.is_empty() || s.starts_with('-') || s.chars().any(|c| c.is_whitespace() || c.is_control()) {
            Err(format!("unsafe {what}: {s:?}"))
        } else {
            Ok(s.to_string())
        }
    };
    let vars = [
        ("{algo}", safe(&a.algo, "algo")?),
        ("{pool}", safe(&a.pool.url, "pool")?),
        ("{user}", safe(&a.pool.user, "user")?),
        ("{pass}", safe(&a.pool.pass, "pass")?),
        ("{device}", device.to_string()),
        ("{apiPort}", api_port.to_string()),
    ];
    Ok(template
        .iter()
        .map(|t| vars.iter().fold(t.clone(), |acc, (k, v)| acc.replace(k, v)))
        .collect())
}

#[derive(Debug, Clone, PartialEq)]
pub enum MinerState {
    Stopped,
    Running { pid: u32, since: Instant },
    /// Crashed; waiting until `retry_at` before restarting.
    Backoff { retry_at: Instant, failures: u32 },
}

/// Runs one miner process for one GPU and restarts it with backoff if it crashes.
pub struct Supervisor {
    exe: PathBuf,
    args: Vec<String>,
    child: Option<Child>,
    pub state: MinerState,
    failures: u32,
    /// Where the miner's output goes (appended), so a crash can be diagnosed. None = discard.
    log: Option<PathBuf>,
}

impl Supervisor {
    pub fn new(exe: PathBuf, args: Vec<String>) -> Self {
        Self { exe, args, child: None, state: MinerState::Stopped, failures: 0, log: None }
    }

    /// Send the miner's output to this file (appended) instead of discarding it.
    pub fn with_log(mut self, path: PathBuf) -> Self {
        self.log = Some(path);
        self
    }

    pub fn start(&mut self) -> Result<(), String> {
        let mut cmd = Command::new(&self.exe);
        cmd.args(&self.args).stdin(Stdio::null());
        match self.log.as_ref().and_then(|p| std::fs::OpenOptions::new().create(true).append(true).open(p).ok()) {
            Some(f) => {
                let err = f.try_clone().map_err(|e| e.to_string())?;
                cmd.stdout(f).stderr(err);
            }
            None => { cmd.stdout(Stdio::null()).stderr(Stdio::null()); }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // Run without a console window. The app's tray icon is the visible sign that mining is on.
            cmd.creation_flags(0x0800_0000);
        }
        let child = cmd.spawn().map_err(|e| format!("could not start {}: {e}", self.exe.display()))?;
        self.state = MinerState::Running { pid: child.id(), since: Instant::now() };
        self.child = Some(child);
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        self.state = MinerState::Stopped;
    }

    /// Call periodically. Detects crashes and restarts after 5s, 10s, 20s ... up to 5 minutes.
    pub fn tick(&mut self) -> Result<(), String> {
        match &self.state {
            MinerState::Running { since, .. } => {
                let since = *since;
                if let Some(c) = self.child.as_mut() {
                    if let Some(status) = c.try_wait().map_err(|e| e.to_string())? {
                        self.child = None;
                        if let Some(log) = &self.log {
                            use std::io::Write;
                            if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(log) {
                                let code = status.code().map(|c| format!("{c} (0x{:08X})", c as u32)).unwrap_or_else(|| "none".into());
                                let _ = writeln!(f, "--- exited after {:.1}s, exit code {code}", since.elapsed().as_secs_f64());
                            }
                        }
                        // A miner that ran for 10+ minutes before exiting resets the backoff.
                        if since.elapsed() > Duration::from_secs(600) { self.failures = 0; }
                        self.failures += 1;
                        let wait = Duration::from_secs((5u64 << self.failures.min(6)).min(300));
                        self.state = MinerState::Backoff { retry_at: Instant::now() + wait, failures: self.failures };
                    }
                }
            }
            MinerState::Backoff { retry_at, .. } if Instant::now() >= *retry_at => self.start()?,
            _ => {}
        }
        Ok(())
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signed::PoolTarget;

    fn assignment() -> Assignment {
        Assignment {
            v: 1, rig_id: "pc".into(), wallet: "W".into(), gpu_index: 0, gpu: "RTX 4070".into(), coin: "PRL".into(),
            algo: "pearlhash".into(), miner_id: "prl-miner".into(),
            pool: PoolTarget { url: "stratum+tcp://p:1".into(), user: "W.pc-0".into(), pass: "x".into() },
            expected_usd_per_day: 2.9, reason: String::new(), issued_at: 0, expires_at: 1,
        }
    }

    #[test]
    fn renders_args() {
        let t: Vec<String> = ["--algo", "{algo}", "-o", "{pool}", "-u", "{user}", "-d", "{device}", "--api", "127.0.0.1:{apiPort}"].map(String::from).to_vec();
        let args = render_args(&t, &assignment(), 1, 4067).unwrap();
        assert_eq!(args, ["--algo", "pearlhash", "-o", "stratum+tcp://p:1", "-u", "W.pc-0", "-d", "1", "--api", "127.0.0.1:4067"]);
    }

    #[test]
    fn rejects_flag_injection() {
        let mut a = assignment();
        a.pool.pass = "x --donate 100".into();
        assert!(render_args(&["{pass}".into()], &a, 0, 1).is_err());
        a.pool.pass = "--evil".into();
        assert!(render_args(&["{pass}".into()], &a, 0, 1).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn supervisor_restarts_after_crash() {
        let mut s = Supervisor::new("/bin/sh".into(), vec!["-c".into(), "exit 1".into()]);
        s.start().unwrap();
        std::thread::sleep(Duration::from_millis(200));
        s.tick().unwrap();
        assert!(matches!(s.state, MinerState::Backoff { failures: 1, .. }));
        s.stop();
        assert_eq!(s.state, MinerState::Stopped);
    }
}
