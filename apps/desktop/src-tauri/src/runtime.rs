//! The mining loop: check in with the server, verify what it says, run the right miners.

use hashcoin_core::{
    gpu::{parse_nvidia_smi, parse_video_controllers},
    manifest::{extract_zip, platform_key, verify_download},
    miner::{render_args, MinerState, Supervisor},
    plan, Action, Assignment, Envelope, Gpu, KeyRing, MinerManifest,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const CHECK_IN_EVERY: Duration = Duration::from_secs(5 * 60);
const MAX_DOWNLOAD: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub wallet: String,
    pub rig_id: String,
    pub api_base: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuStatus {
    pub gpu: Gpu,
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
}

struct Slot {
    gpu: Gpu,
    assignment: Option<Assignment>,
    supervisor: Option<Supervisor>,
    reason: String,
}

pub struct Runtime {
    pub settings: Settings,
    keys: KeyRing,
    data_dir: PathBuf,
    slots: Vec<Slot>,
    manifest: Option<MinerManifest>,
    pub mining: bool,
    last_check_in: Option<Instant>,
    last_check_in_at: Option<String>,
    error: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Find GPUs: NVIDIA through nvidia-smi (gives the device index miners use), AMD and Intel Arc
/// through the Windows video controller list.
pub fn detect_gpus() -> Vec<Gpu> {
    let mut gpus = Vec::new();
    if let Ok(out) = quiet(Command::new("nvidia-smi").args(["--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"])).output() {
        gpus.extend(parse_nvidia_smi(&String::from_utf8_lossy(&out.stdout)));
    }
    #[cfg(windows)]
    if let Ok(out) = quiet(Command::new("powershell").args(["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"])).output() {
        gpus.extend(parse_video_controllers(&String::from_utf8_lossy(&out.stdout)));
    }
    #[cfg(not(windows))]
    let _ = parse_video_controllers;
    gpus
}

impl Runtime {
    pub fn new(settings: Settings, keys: KeyRing, data_dir: PathBuf) -> Self {
        Self { settings, keys, data_dir, slots: Vec::new(), manifest: None, mining: false, last_check_in: None, last_check_in_at: None, error: None }
    }

    pub fn set_gpus(&mut self, gpus: Vec<Gpu>) {
        self.stop();
        self.slots = gpus.into_iter().map(|gpu| Slot { gpu, assignment: None, supervisor: None, reason: "not started".into() }).collect();
    }

    pub fn start(&mut self) -> Result<(), String> {
        if !hashcoin_core::wallet::is_solana_address(&self.settings.wallet) {
            return Err("Add your Solana wallet address first.".into());
        }
        if self.slots.is_empty() {
            return Err("No supported GPU found. Hashcoin needs an NVIDIA, AMD or Intel Arc graphics card.".into());
        }
        self.mining = true;
        self.last_check_in = None; // check in right away
        Ok(())
    }

    pub fn stop(&mut self) {
        self.mining = false;
        for s in &mut self.slots {
            if let Some(mut sup) = s.supervisor.take() { sup.stop(); }
            s.assignment = None;
            s.reason = "stopped".into();
        }
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
        for s in &mut self.slots {
            if let Some(sup) = s.supervisor.as_mut() {
                if let Err(e) = sup.tick() { s.reason = e; }
            }
            // Never keep mining on an expired assignment (e.g. the server is unreachable for long).
            if s.assignment.as_ref().is_some_and(|a| now_ms() >= a.expires_at) {
                if let Some(mut sup) = s.supervisor.take() { sup.stop(); }
                s.assignment = None;
                s.reason = "assignment expired; waiting for the server".into();
            }
        }
    }

    fn get_signed<T: serde::de::DeserializeOwned>(&self, env: Envelope) -> Result<T, String> {
        self.keys.verify(&env)
    }

    fn check_in(&mut self) -> Result<(), String> {
        let base = self.settings.api_base.trim_end_matches('/').to_string();
        if self.manifest.is_none() {
            let env: Envelope = ureq::get(&format!("{base}/v1/miners")).timeout(Duration::from_secs(20)).call().map_err(|e| format!("server unreachable: {e}"))?
                .into_json().map_err(|e| e.to_string())?;
            self.manifest = Some(self.get_signed(env)?);
        }
        let gpus: Vec<_> = self.slots.iter().map(|s| serde_json::json!({ "index": s.gpu.index, "name": s.gpu.name })).collect();
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
            let Some(i) = self.slots.iter().position(|s| s.gpu.index == r.gpu_index) else { continue };
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
                    if let Some(mut sup) = self.slots[i].supervisor.take() { sup.stop(); }
                    let started = self.launch(&a, self.slots[i].gpu.index);
                    match started {
                        Ok(sup) => { self.slots[i].supervisor = Some(sup); self.slots[i].reason = r.reason; self.slots[i].assignment = Some(a); }
                        Err(e) => { self.slots[i].assignment = None; self.slots[i].reason = e; }
                    }
                }
            }
        }
        Ok(())
    }

    fn launch(&self, a: &Assignment, device: u32) -> Result<Supervisor, String> {
        let manifest = self.manifest.as_ref().ok_or("no miner list")?;
        let spec = manifest.find(&a.miner_id).ok_or_else(|| format!("miner {} not in signed list", a.miner_id))?;
        let build = spec.builds.get(&platform_key()).ok_or_else(|| format!("{} has no build for {}", spec.id, platform_key()))?;
        let dir = self.data_dir.join("miners").join(&spec.id).join(&spec.version);
        let exe = dir.join(&build.exe);
        if !exe.exists() {
            download_verified(&build.url, &build.sha256, &dir)?;
        }
        let args = render_args(&spec.args, a, device, 4067 + device as u16)?;
        let mut sup = Supervisor::new(exe, args);
        sup.start()?;
        Ok(sup)
    }

    pub fn status(&self) -> Status {
        Status {
            settings: self.settings.clone(),
            mining: self.mining,
            last_check_in: self.last_check_in_at.clone(),
            error: self.error.clone(),
            gpus: self.slots.iter().map(|s| GpuStatus {
                gpu: s.gpu.clone(),
                coin: s.assignment.as_ref().map(|a| a.coin.clone()),
                expected_usd_per_day: s.assignment.as_ref().map(|a| a.expected_usd_per_day),
                reason: s.reason.clone(),
                state: match s.supervisor.as_ref().map(|x| &x.state) {
                    Some(MinerState::Running { .. }) => "mining".into(),
                    Some(MinerState::Backoff { failures, .. }) => format!("restarting (crash {failures})"),
                    _ => "idle".into(),
                },
            }).collect(),
        }
    }
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
        let dir = data.join("miners/prl-miner/0.0.0");
        std::fs::create_dir_all(&dir).unwrap();
        let exe_name = format!("stand_in_miner{}", std::env::consts::EXE_SUFFIX);
        let built = std::env::current_exe().unwrap().parent().unwrap().parent().unwrap().join("examples").join(exe_name);
        std::fs::copy(&built, dir.join(format!("prl-miner{}", std::env::consts::EXE_SUFFIX)))
            .unwrap_or_else(|e| panic!("stand-in miner not built at {}: {e}", built.display()));

        let wallet = "4Nd1mYwSzKj7hJkBFtyxGRy3tHn1Ag7e4Ki6UPWuKEPF";
        let mut rt = Runtime::new(Settings { wallet: wallet.into(), rig_id: "e2e".into(), api_base: api }, keys, data.clone());
        rt.set_gpus(vec![Gpu { index: 0, name: "NVIDIA GeForce RTX 4070".into(), vendor: Vendor::Nvidia, memory_mb: Some(12282) }]);
        rt.start().unwrap();
        rt.tick();
        let st = rt.status();
        assert_eq!(st.error, None);
        assert_eq!(st.gpus[0].coin.as_deref(), Some("PRL"));
        assert_eq!(st.gpus[0].state, "mining");
        let mut args = String::new();
        for _ in 0..50 {
            std::thread::sleep(Duration::from_millis(100));
            if let Ok(a) = std::fs::read_to_string(dir.join("args.txt")) { args = a; break; }
        }
        assert!(args.contains(&format!("--user {wallet}.e2e-0")), "{args}");
        assert!(args.contains("--algo pearlhash"));

        rt.stop();
        assert_eq!(rt.status().gpus[0].state, "idle");
        std::fs::remove_dir_all(&data).ok();
    }
}
