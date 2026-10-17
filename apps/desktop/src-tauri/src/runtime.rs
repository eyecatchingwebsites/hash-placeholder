//! The mining loop: check in with the server, verify what it says, run the right miners.

use crate::system;
use hashcoin_core::{
    blocked::{exe_blocked, exe_state, exit_looks_blocked, spawn_blocked, StartMarker},
    gpu::parse_video_controllers,
    manifest::{extract_zip, platform_key, verify_download},
    miner::{render_command, MinerState, Supervisor},
    plan, Action, Assignment, Envelope, Gpu, Guard, KeyRing, Limits, MinerManifest, Readings, SafetySettings, Vendor,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const CHECK_IN_EVERY: Duration = Duration::from_secs(5 * 60);
const MAX_DOWNLOAD: u64 = 200 * 1024 * 1024;

/// The settings file. Every field has a default, so a file missing some (an older version, or one
/// edited by hand) still loads instead of silently falling back to all defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub wallet: String,
    pub rig_id: String,
    /// A server set on purpose (by hand in the file), instead of the one built into the app. Empty =
    /// the built-in server, and the app never writes one here. Versions before Oct 17 saved their
    /// built-in address as `apiBase`, which then pinned every later build to it; that key is ignored.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub api_override: String,
    /// Open in the tray and start mining when Windows starts. Off until the user turns it on.
    pub start_with_windows: bool,
    /// Mine only after `idle_minutes` without keyboard or mouse input.
    pub only_when_idle: bool,
    pub idle_minutes: u32,
    /// Pause while a game (or any app) is fullscreen.
    pub pause_when_fullscreen: bool,
    /// Pause a card at this temperature; it resumes 8 °C lower.
    pub temp_limit_c: u32,
    /// Board power cap in watts, for miners with a power-limit flag. None = the card's own limit.
    pub power_limit_w: Option<u32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            wallet: String::new(), rig_id: String::new(), api_override: String::new(),
            start_with_windows: false, only_when_idle: false, idle_minutes: 5, pause_when_fullscreen: false,
            temp_limit_c: 83, power_limit_w: None,
        }
    }
}

impl Settings {
    /// The server to use: the override if there is a real one, else the app's built-in server.
    /// A placeholder address (`*.invalid`) never wins.
    pub fn server(&self, built_in: &str) -> String {
        let o = self.api_override.trim().trim_end_matches('/');
        let real = (o.starts_with("https://") || o.starts_with("http://")) && !o.contains(".invalid");
        if real { o.to_string() } else { built_in.trim_end_matches('/').to_string() }
    }

    /// Keep the safety values in a sane range, whatever the file or the window sent.
    pub fn clamped(mut self) -> Self {
        self.temp_limit_c = self.temp_limit_c.clamp(65, 83);
        self.idle_minutes = self.idle_minutes.clamp(1, 120);
        self.power_limit_w = self.power_limit_w.filter(|w| (50..=600).contains(w));
        self
    }

    pub fn safety(&self) -> SafetySettings {
        SafetySettings {
            temp_limit_c: self.temp_limit_c,
            temp_resume_c: self.temp_limit_c - 8,
            only_when_idle: self.only_when_idle,
            idle_after: Duration::from_secs(60 * self.idle_minutes as u64),
            pause_when_fullscreen: self.pause_when_fullscreen,
        }
    }

    pub fn limits(&self) -> Limits {
        Limits { temp_limit_c: self.temp_limit_c, temp_resume_c: self.temp_limit_c - 8, power_limit_w: self.power_limit_w }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuStatus {
    pub gpu: Gpu,
    pub temp_c: Option<u32>,
    pub coin: Option<String>,
    pub expected_usd_per_day: Option<f64>,
    pub reason: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub settings: Settings,
    pub mining: bool,
    pub gpus: Vec<GpuStatus>,
    pub last_check_in: Option<String>,
    pub error: Option<String>,
    /// Set when antivirus looks to have stopped the miner or the app; the window explains it.
    pub blocked: Option<Blocked>,
}

/// Antivirus (in practice Microsoft Defender) looks to have stopped mining.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blocked {
    /// "miner": the miner was removed or killed. "app": the app itself was closed while it started one.
    pub what: String,
    /// What the app saw, in plain words.
    pub detail: String,
}

/// Why a miner couldn't be started.
enum LaunchError {
    /// It looks like antivirus stopped it: mining stops and the window explains.
    Blocked(String),
    /// Anything else: shown on the card, retried at the next check-in.
    Other(String),
}

impl From<String> for LaunchError {
    fn from(e: String) -> Self { LaunchError::Other(e) }
}
impl From<&str> for LaunchError {
    fn from(e: &str) -> Self { LaunchError::Other(e.into()) }
}

/// A miner that has run this long has got past the point where Defender kills it on sight.
const STARTED_OK_AFTER: Duration = Duration::from_secs(30);

struct Slot {
    /// Unique per GPU on this rig, used with the server (assignments, pool worker names). `gpu.index`
    /// is the miner's device number, which counts per vendor, so an NVIDIA and an AMD card can
    /// both be device 0.
    id: u32,
    gpu: Gpu,
    assignment: Option<Assignment>,
    supervisor: Option<Supervisor>,
    reason: String,
    /// Why the safety guard is holding this GPU back (too hot, PC in use, fullscreen game).
    paused: Option<String>,
}

pub struct Runtime {
    pub settings: Settings,
    /// The server in use (`Settings::server`), resolved once at start.
    pub api_base: String,
    keys: KeyRing,
    data_dir: PathBuf,
    slots: Vec<Slot>,
    manifest: Option<MinerManifest>,
    pub mining: bool,
    last_check_in: Option<Instant>,
    last_check_in_at: Option<String>,
    error: Option<String>,
    guard: Guard,
    blocked: Option<Blocked>,
    /// Exists while a miner is starting (see `blocked::StartMarker`).
    marker: StartMarker,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Find GPUs: NVIDIA through NVIDIA's own library (gives the device index miners use), AMD and
/// Intel Arc through DirectX's adapter list. Read in-process: no helper programs.
pub fn detect_gpus() -> Vec<Gpu> {
    let mut gpus = system::nvidia_gpus();
    gpus.extend(parse_video_controllers(&system::display_adapters().join("
")));
    gpus
}

impl Runtime {
    pub fn new(settings: Settings, api_base: String, keys: KeyRing, data_dir: PathBuf) -> Self {
        Self { settings, api_base, keys, slots: Vec::new(), manifest: None, mining: false, last_check_in: None, last_check_in_at: None, error: None, guard: Guard::default(),
            blocked: None, marker: StartMarker::new(data_dir.join("miner-starting")), data_dir }
    }

    pub fn set_gpus(&mut self, gpus: Vec<Gpu>) {
        self.stop();
        self.slots = gpus.into_iter().enumerate().map(|(id, gpu)| Slot { id: id as u32, gpu, assignment: None, supervisor: None, reason: "not started".into(), paused: None }).collect();
        self.guard = Guard::default();
    }

    /// Change the settings. Miners restart with new temperature or power flags.
    pub fn apply_settings(&mut self, next: Settings) {
        let restart = next.limits() != self.settings.limits();
        self.settings = next;
        if restart {
            for s in &mut self.slots {
                if let Some(mut sup) = s.supervisor.take() { sup.stop(); } // the next tick starts it again
            }
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        if !hashcoin_core::wallet::is_solana_address(&self.settings.wallet) {
            return Err("Add your Solana wallet address first.".into());
        }
        if self.slots.is_empty() {
            return Err("No supported GPU found. Hashcoin needs an NVIDIA, AMD or Intel Arc graphics card.".into());
        }
        self.mining = true;
        self.blocked = None; // the user chose to try again
        self.last_check_in = None; // check in right away
        Ok(())
    }

    /// At launch: if the last run was closed while it started a miner, say so (Defender's kill of
    /// the app looks like that).
    pub fn check_start_marker(&mut self) {
        if self.marker.left_over() {
            self.blocked = Some(Blocked { what: "app".into(), detail: "Hashcoin was closed while it started the miner".into() });
        }
    }

    pub fn is_blocked(&self) -> bool { self.blocked.is_some() }

    /// Test builds only (see `defender_preview` in main.rs): show the Defender message as if `what`
    /// ("miner" or "app") had been blocked, to review it. Mining stops, as it would for real.
    pub fn preview_blocked(&mut self, what: &str) {
        self.stop();
        self.blocked = Some(Blocked { what: what.into(), detail: "nothing, this is a preview in a test build".into() });
    }

    /// "Not now": hide the explanation. Mining stays off.
    pub fn dismiss_blocked(&mut self) { self.blocked = None; }

    /// Antivirus looks to have stopped the miner: stop everything and explain.
    fn block(&mut self, detail: String) {
        self.stop();
        self.blocked = Some(Blocked { what: "miner".into(), detail });
    }

    pub fn stop(&mut self) {
        self.mining = false;
        for s in &mut self.slots {
            if let Some(mut sup) = s.supervisor.take() { sup.stop(); }
            s.assignment = None;
            s.reason = "stopped".into();
            s.paused = None;
        }
        self.marker.clear();
    }

    /// Called every few seconds by the background thread.
    pub fn tick(&mut self) {
        if !self.mining { return; }
        let due = self.last_check_in.is_none_or(|t| t.elapsed() >= CHECK_IN_EVERY)
            || self.slots.iter().any(|s| s.assignment.as_ref().is_some_and(|a| now_ms() + 60_000 >= a.expires_at));
        if due {
            self.last_check_in = Some(Instant::now());
            match self.check_in() {
                Ok(()) => { self.error = None; self.last_check_in_at = Some(format!("{}", now_ms())); }
                Err(e) => self.error = Some(e),
            }
        }
        self.update_guard();
        let safety = self.settings.safety();
        let mut blocked = None;
        for i in 0..self.slots.len() {
            let s = &mut self.slots[i];
            if let Some(sup) = s.supervisor.as_mut() {
                if let Err(e) = sup.tick() { s.reason = e; }
                if let Some(why) = blocked_by(sup) { blocked = Some(why); }
                if self.marker.is_set() && matches!(sup.state, MinerState::Running { since, .. } if since.elapsed() >= STARTED_OK_AFTER) {
                    self.marker.clear();
                }
            }
            // Never keep mining on an expired assignment (e.g. the server is unreachable for long).
            if s.assignment.as_ref().is_some_and(|a| now_ms() >= a.expires_at) {
                if let Some(mut sup) = s.supervisor.take() { sup.stop(); }
                s.assignment = None;
                s.reason = "assignment expired; waiting for the server".into();
            }
            // A safety pause stops the miner but keeps the assignment, so mining resumes by itself.
            s.paused = self.guard.pause_for(s.id, &safety).map(|p| p.describe());
            if s.paused.is_some() {
                if let Some(mut sup) = s.supervisor.take() { sup.stop(); }
            } else if s.supervisor.is_none() {
                if let Some(a) = s.assignment.clone() {
                    let (id, device) = (s.id, s.gpu.index);
                    match self.launch(&a, id, device) {
                        Ok(sup) => self.slots[i].supervisor = Some(sup),
                        Err(LaunchError::Blocked(why)) => { blocked = Some(why); break; }
                        Err(LaunchError::Other(e)) => { self.slots[i].assignment = None; self.slots[i].reason = e; }
                    }
                }
            }
        }
        if let Some(why) = blocked { self.block(why); }
    }

    /// Measure what the safety settings need (temperatures always; input and fullscreen only when
    /// those options are on) and update the guard.
    fn update_guard(&mut self) {
        let s = self.settings.safety();
        let mut r = Readings::default();
        if self.slots.iter().any(|x| x.gpu.vendor == Vendor::Nvidia) {
            let by_index = system::nvidia_temps();
            for x in self.slots.iter().filter(|x| x.gpu.vendor == Vendor::Nvidia) {
                if let Some(&t) = by_index.get(&x.gpu.index) { r.temps.insert(x.id, t); }
            }
        }
        if s.only_when_idle { r.idle = system::idle_time(); }
        if s.pause_when_fullscreen { r.fullscreen = system::fullscreen_app(); }
        // Slots whose miner pauses hot cards itself: the app only steps in as a backstop there.
        let own_limit: Vec<u32> = self.slots.iter().filter(|x| {
            x.assignment.as_ref().and_then(|a| self.manifest.as_ref()?.find(&a.miner_id)).is_some_and(|m| m.handles_temperature())
        }).map(|x| x.id).collect();
        self.guard.update(&s, &r, |slot| own_limit.contains(&slot), Instant::now());
    }

    fn get_signed<T: serde::de::DeserializeOwned>(&self, env: Envelope) -> Result<T, String> {
        self.keys.verify(&env)
    }

    fn check_in(&mut self) -> Result<(), String> {
        let base = self.api_base.clone();
        if self.manifest.is_none() {
            let env: Envelope = ureq::get(&format!("{base}/v1/miners")).timeout(Duration::from_secs(20)).call().map_err(|e| format!("server unreachable: {e}"))?
                .into_json().map_err(|e| e.to_string())?;
            self.manifest = Some(self.get_signed(env)?);
        }
        let gpus: Vec<_> = self.slots.iter().map(|s| serde_json::json!({ "index": s.id, "name": s.gpu.name })).collect();
        let body = serde_json::json!({ "wallet": self.settings.wallet, "rigId": self.settings.rig_id, "gpus": gpus });
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Res { gpu_index: u32, assignment: Option<Envelope>, reason: String }
        #[derive(Deserialize)]
        struct Resp { results: Vec<Res> }
        let resp: Resp = ureq::post(&format!("{base}/v1/assignments")).timeout(Duration::from_secs(20)).send_json(body)
            .map_err(|e| format!("check-in failed: {e}"))?.into_json().map_err(|e| e.to_string())?;

        let (wallet, rig) = (self.settings.wallet.clone(), self.settings.rig_id.clone());
        for r in resp.results {
            let next: Result<Assignment, String> = match r.assignment {
                None => Err(r.reason.clone()),
                Some(env) => self.get_signed::<Assignment>(env).and_then(|a| a.check(&wallet, &rig, r.gpu_index, now_ms()).map(|_| a)),
            };
            let Some(i) = self.slots.iter().position(|s| s.id == r.gpu_index) else { continue };
            match plan(self.slots[i].assignment.as_ref(), next) {
                Action::Keep(a) => {
                    // Same target: refresh the expiry without restarting the miner.
                    self.slots[i].assignment = Some(a);
                    self.slots[i].reason = r.reason;
                }
                Action::Stop(why) => {
                    if let Some(mut sup) = self.slots[i].supervisor.take() { sup.stop(); }
                    self.slots[i].assignment = None;
                    self.slots[i].reason = why;
                }
                Action::Run(a) => {
                    // New coin or pool: stop the old miner. The tick starts the new one, unless a
                    // safety pause is holding this GPU back.
                    if let Some(mut sup) = self.slots[i].supervisor.take() { sup.stop(); }
                    self.slots[i].assignment = Some(a);
                    self.slots[i].reason = r.reason;
                }
            }
        }
        Ok(())
    }

    fn launch(&self, a: &Assignment, slot: u32, device: u32) -> Result<Supervisor, LaunchError> {
        let manifest = self.manifest.as_ref().ok_or("no miner list")?;
        let spec = manifest.find(&a.miner_id).ok_or_else(|| format!("miner {} not in signed list", a.miner_id))?;
        let build = spec.builds.get(&platform_key()).ok_or_else(|| format!("{} has no build for {}", spec.id, platform_key()))?;
        let dir = self.data_dir.join("miners").join(&spec.id).join(&spec.version);
        let exe = dir.join(&build.exe);
        if !exe.exists() {
            download_verified(&build.url, &build.sha256, &dir)?;
        }
        // Verified and unpacked, but quarantined straight away?
        if let Some(why) = exe_blocked(&exe_state(&exe)) { return Err(LaunchError::Blocked(why)); }
        let args = render_command(spec, a, device, 4067 + slot as u16, &self.settings.limits())?;
        // One log per GPU next to the miner, kept small: started fresh on each launch.
        let log = dir.join(format!("gpu-{slot}.log"));
        let _ = std::fs::write(&log, format!("--- {} {}
", exe.display(), args.join(" ")));
        let mut sup = Supervisor::new(exe, args).with_log(log);
        self.marker.set();
        if let Err(e) = sup.start() {
            self.marker.clear();
            return Err(if spawn_blocked(sup.take_spawn_error()) { LaunchError::Blocked(format!("Windows wouldn't start the miner ({e})")) } else { LaunchError::Other(e) });
        }
        Ok(sup)
    }

    pub fn status(&self) -> Status {
        Status {
            settings: self.settings.clone(),
            mining: self.mining,
            last_check_in: self.last_check_in_at.clone(),
            error: self.error.clone(),
            blocked: self.blocked.clone(),
            gpus: self.slots.iter().map(|s| GpuStatus {
                gpu: s.gpu.clone(),
                temp_c: if self.mining { self.guard.temp(s.id) } else { None },
                coin: s.assignment.as_ref().map(|a| a.coin.clone()),
                expected_usd_per_day: s.assignment.as_ref().map(|a| a.expected_usd_per_day),
                reason: s.paused.clone().unwrap_or_else(|| s.reason.clone()),
                state: match (&s.paused, s.supervisor.as_ref().map(|x| &x.state)) {
                    (Some(_), _) => "paused".into(),
                    (_, Some(MinerState::Running { .. })) => "mining".into(),
                    (_, Some(MinerState::Backoff { failures, .. })) => format!("restarting (crash {failures})"),
                    _ => "idle".into(),
                },
            }).collect(),
        }
    }
}

/// After a supervisor tick: does the way the miner ended (or failed to restart) look like antivirus?
fn blocked_by(sup: &mut Supervisor) -> Option<String> {
    if spawn_blocked(sup.take_spawn_error()) {
        return Some("Windows wouldn't start the miner again".into());
    }
    let exit = sup.take_exit()?;
    exit_looks_blocked(&exit, &exe_state(sup.exe()))
}

/// Download a miner, check its SHA-256 against the signed manifest, then unpack it.
fn download_verified(url: &str, sha256: &str, dir: &Path) -> Result<(), String> {
    if !url.starts_with("https://") { return Err("miner downloads must use https".into()); }
    let resp = ureq::get(url).timeout(Duration::from_secs(300)).call().map_err(|e| format!("download failed: {e}"))?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(resp.into_reader(), MAX_DOWNLOAD), &mut bytes).map_err(|e| e.to_string())?;
    verify_download(&bytes, sha256)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    extract_zip(&bytes, dir)?;
    #[cfg(unix)]
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(entry.path(), std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(dir: &str) -> (Runtime, PathBuf) {
        let data = std::env::temp_dir().join(format!("hashcoin-rt-{}-{dir}", std::process::id()));
        std::fs::create_dir_all(&data).unwrap();
        let s = Settings { wallet: "4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF".into(), rig_id: "pc".into(), ..Default::default() };
        (Runtime::new(s, "http://127.0.0.1:9".into(), KeyRing::default(), data.clone()), data)
    }

    #[test]
    fn explains_when_the_app_was_closed_while_starting_a_miner() {
        let (mut rt, data) = runtime("marker");
        rt.check_start_marker();
        assert_eq!(rt.status().blocked, None, "a normal launch");
        // The last run set the marker and was killed before the miner got going.
        StartMarker::new(data.join("miner-starting")).set();
        let (mut rt, _) = runtime("marker");
        rt.check_start_marker();
        assert_eq!(rt.status().blocked.map(|b| b.what), Some("app".into()));
        assert!(!rt.mining, "mining stays off until the user starts it");
        rt.dismiss_blocked(); // "Not now"
        assert_eq!(rt.status().blocked, None);
        assert!(!rt.mining);
        let (mut rt, _) = runtime("marker");
        rt.check_start_marker();
        assert_eq!(rt.status().blocked, None, "reported once");
        std::fs::remove_dir_all(&data).ok();
    }

    #[test]
    fn a_miner_killed_on_start_is_reported_and_mining_stops() {
        #[cfg(windows)]
        let (exe, args) = (PathBuf::from(r"C:\Windows\System32\cmd.exe"), vec!["/C".to_string(), "exit 5".to_string()]);
        #[cfg(unix)]
        let (exe, args) = (PathBuf::from("/bin/sh"), vec!["-c".to_string(), "exit 5".to_string()]);
        let mut sup = Supervisor::new(exe, args);
        sup.start().unwrap();
        let mut why = None;
        for _ in 0..50 {
            std::thread::sleep(Duration::from_millis(100));
            let _ = sup.tick();
            if let Some(w) = blocked_by(&mut sup) { why = Some(w); break; }
        }
        assert!(why.is_some(), "an instant exit with access denied and no output looks blocked");
        sup.stop();

        let (mut rt, data) = runtime("block");
        rt.mining = true;
        rt.block(why.unwrap());
        let st = rt.status();
        assert!(!st.mining);
        assert_eq!(st.blocked.map(|b| b.what), Some("miner".into()));
        assert!(!data.join("miner-starting").exists());
        rt.set_gpus(vec![Gpu { index: 0, name: "NVIDIA GeForce RTX 4070".into(), vendor: Vendor::Nvidia, memory_mb: None }]);
        rt.start().unwrap();
        assert_eq!(rt.status().blocked, None, "starting again clears it");
        std::fs::remove_dir_all(&data).ok();
    }

    const BUILT_IN: &str = "http://127.0.0.1:8787";

    #[test]
    fn an_old_saved_server_never_overrides_the_built_in_one() {
        // Written by builds before Oct 17 (the placeholder came from the settings fallback bug).
        for old in [
            r#"{"wallet":"W","rigId":"pc","apiBase":"https://api.hashcoin.invalid"}"#,
            r#"{"wallet":"W","rigId":"pc","apiBase":"http://127.0.0.1:8787","startWithWindows":true}"#,
        ] {
            let s: Settings = serde_json::from_str(old).unwrap();
            assert_eq!(s.server("https://api.example.com"), "https://api.example.com", "{old}");
            assert_eq!(s.wallet, "W");
            // Saving it back drops the old key and writes no server at all.
            let saved = serde_json::to_string(&s).unwrap();
            assert!(!saved.contains("apiBase") && !saved.contains("apiOverride"), "{saved}");
        }
    }

    #[test]
    fn a_deliberate_override_wins_unless_it_is_a_placeholder() {
        let mut s = Settings { api_override: "https://staging.example.com/".into(), ..Default::default() };
        assert_eq!(s.server(BUILT_IN), "https://staging.example.com");
        assert!(serde_json::to_string(&s).unwrap().contains(r#""apiOverride":"https://staging.example.com/""#));
        for bad in ["https://api.hashcoin.invalid", "not a url", ""] {
            s.api_override = bad.into();
            assert_eq!(s.server(BUILT_IN), BUILT_IN, "{bad}");
        }
    }
}

// The configured miner (ForgeMiner) only has a Windows build, so the end-to-end test runs on Windows.
#[cfg(all(test, windows))]
mod e2e {
    //! End-to-end against a running API (services/api). Ignored by default; run with
    //! HASHCOIN_E2E_API=http://127.0.0.1:8787 HASHCOIN_E2E_PUBKEY=<dev key> cargo test -p hashcoin-miner -- --ignored
    use super::*;
    use hashcoin_core::Vendor;

    #[test]
    #[ignore]
    fn checks_in_verifies_and_starts_miner() {
        let api = std::env::var("HASHCOIN_E2E_API").expect("HASHCOIN_E2E_API");
        let mut keys = KeyRing::default();
        keys.add_b64("dev", &std::env::var("HASHCOIN_E2E_PUBKEY").expect("HASHCOIN_E2E_PUBKEY")).unwrap();
        let data = std::env::temp_dir().join(format!("hashcoin-e2e-{}", std::process::id()));
        // Stand-in miner (examples/stand_in_miner.rs, built by `cargo test`): pre-placed where a
        // verified download would go, so no network fetch is needed.
        let dir = data.join("miners/forgeminer/1.8.8/ForgeMiner-1.8.8-windows");
        std::fs::create_dir_all(&dir).unwrap();
        let exe_name = format!("stand_in_miner{}", std::env::consts::EXE_SUFFIX);
        let built = std::env::current_exe().unwrap().parent().unwrap().parent().unwrap().join("examples").join(exe_name);
        std::fs::copy(&built, dir.join("forge.exe"))
            .unwrap_or_else(|e| panic!("stand-in miner not built at {}: {e}", built.display()));

        let wallet = "4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF";
        let mut rt = Runtime::new(Settings { wallet: wallet.into(), rig_id: "e2e".into(), ..Default::default() }, api, keys, data.clone());
        // An NVIDIA and an AMD card are both device 0 to their miners; the app must keep them apart
        // (this used to apply the AMD card's "no coin" answer to the NVIDIA card and stop it).
        rt.set_gpus(vec![
            Gpu { index: 0, name: "NVIDIA GeForce RTX 4070".into(), vendor: Vendor::Nvidia, memory_mb: Some(12282) },
            Gpu { index: 0, name: "AMD Radeon RX 7900 XTX".into(), vendor: Vendor::Amd, memory_mb: None },
        ]);
        rt.start().unwrap();
        rt.tick();
        let st = rt.status();
        assert_eq!(st.error, None);
        assert_eq!(st.gpus[0].coin.as_deref(), Some("PRL"));
        assert_eq!(st.gpus[0].state, "mining");
        assert_eq!(st.gpus[1].state, "idle");
        assert_eq!(st.gpus[1].coin, None);
        let mut args = String::new();
        for _ in 0..50 {
            std::thread::sleep(Duration::from_millis(100));
            if let Ok(a) = std::fs::read_to_string(dir.join("args.txt")) { args = a; break; }
        }
        // Pool login: the platform payout address + this wallet's short worker id, never the wallet itself.
        let worker = format!(".{}-0 ", hashcoin_core::wallet::worker_id(wallet, "e2e"));
        assert!(args.contains(&worker) && !args.contains(wallet), "{args}");
        assert!(args.contains("--algorithm pearlhash"));
        assert!(args.contains("--temp-limit 83 --temp-resume 75"));
        assert!(!args.contains("--plimit"), "no power cap unless the user sets one");

        rt.stop();
        assert_eq!(rt.status().gpus[0].state, "idle");
        std::fs::remove_dir_all(&data).ok();
    }
}
