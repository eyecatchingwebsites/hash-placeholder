#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;
mod system;

use hashcoin_core::{wallet, KeyRing};
use runtime::{detect_gpus, Runtime, Settings, Status};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Public keys the app trusts for signed assignments and miner lists. Replace before release with
/// the production key from the deploy environment (only the public half goes in the app).
/// The release workflow refuses to build while the placeholder is here.
const TRUSTED_KEYS: &[(&str, &str)] = &[("prod-1", "REPLACE_WITH_PRODUCTION_PUBLIC_KEY")];

/// Local test builds only (`scripts/build-local-test.ps1`): one more trusted key, `kid:base64`,
/// baked in at compile time, so an installed release build can mine against the local dev API.
/// The window says "test build" when it's set; the release workflow refuses to build with it.
const TEST_TRUSTED_KEY: Option<&str> = match option_env!("HASHCOIN_TEST_TRUSTED_KEY") {
    Some(k) if !k.is_empty() => Some(k),
    _ => None,
};

/// The server, set at build time by the release workflow (`HASHCOIN_API_BASE`). Only a deliberate
/// `apiOverride` in the settings file replaces it (see `Settings::server`).
const DEFAULT_API: &str = match option_env!("HASHCOIN_API_BASE") {
    Some(api) if !api.is_empty() => api,
    _ => "https://api.hashcoin.invalid",
};

/// The public source code (linked when Defender blocks Hashcoin).
const SOURCE_URL: &str = match option_env!("HASHCOIN_SOURCE_URL") {
    Some(u) if !u.is_empty() => u,
    _ => "https://github.com/eyecatchingwebsites/hash-placeholder",
};

/// The website's page with each installer's SHA-256 and why Windows warns about miners. Placeholder
/// until the site has it (the window hides a `.invalid` link); the release workflow sets it.
const SAFETY_URL: &str = match option_env!("HASHCOIN_SAFETY_URL") {
    Some(u) if !u.is_empty() => u,
    _ => "https://hashcoin.invalid/safety",
};

/// The website's page with steps per antivirus (Defender, Norton, McAfee, Avast/AVG, Bitdefender,
/// Kaspersky, ESET, Malwarebytes). Placeholder until the site has it (the window hides a `.invalid`
/// link); the release workflow sets it.
const AV_HELP_URL: &str = match option_env!("HASHCOIN_AV_HELP_URL") {
    Some(u) if !u.is_empty() => u,
    _ => "https://hashcoin.invalid/antivirus",
};

/// Passed by the Windows login entry, so the app knows it was started by "Start mining when Windows starts".
const AUTOSTART_ARG: &str = "--autostart";

/// Test and debug builds only: open the "stopped mining" message without an antivirus doing it, to
/// review it. `--show-defender-help` shows it for this PC's antivirus, `--show-defender-help=app` the
/// "closed while starting" version, `--show-defender-help=Avast` (any name) as if that product did it.
/// Release builds (no test key) ignore it.
const DEFENDER_PREVIEW_ARG: &str = "--show-defender-help";
const PREVIEW_ALLOWED: bool = cfg!(debug_assertions) || TEST_TRUSTED_KEY.is_some();

/// Which message a preview argument asks for ("miner" or "app", and an antivirus name if given), if
/// this build allows previews at all.
fn antivirus_preview(args: &[String], allowed: bool) -> Option<(&'static str, Option<String>)> {
    if !allowed { return None; }
    args.iter().find_map(|a| {
        if a == DEFENDER_PREVIEW_ARG { return Some(("miner", None)); }
        let value = a.strip_prefix(DEFENDER_PREVIEW_ARG)?.strip_prefix('=')?.trim();
        Some(match value {
            "app" => ("app", None),
            "miner" | "" => ("miner", None),
            name => ("miner", Some(name.chars().take(60).collect())),
        })
    })
}

type Shared = Arc<Mutex<Runtime>>;

/// An update found by `check_update`, waiting for the user to click Install.
#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);

fn settings_path(dir: &Path) -> PathBuf { dir.join("settings.json") }

/// Written just before an update installs, so the new version resumes mining if the old one was.
fn resume_flag(dir: &Path) -> PathBuf { dir.join("resume-mining") }

fn load_settings(dir: &Path) -> Settings {
    let path = settings_path(dir);
    let mut s: Settings = match std::fs::read_to_string(&path) {
        Ok(t) => serde_json::from_str(&t).unwrap_or_else(|e| {
            eprintln!("Hashcoin Miner: ignoring {} ({e})", path.display());
            Settings::default()
        }),
        Err(_) => Settings::default(),
    };
    if s.rig_id.is_empty() {
        let host = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
        s.rig_id = wallet::rig_id_from_hostname(&host);
    }
    s.clamped()
}

/// The server: the built-in one (`DEFAULT_API`), unless the settings file has a deliberate override.
fn server(s: &Settings) -> String {
    // Development only: point a debug build at a local API without editing the settings file.
    #[cfg(all(debug_assertions, feature = "dev-key"))]
    if let Ok(api) = std::env::var("HASHCOIN_API") {
        return api.trim_end_matches('/').to_string();
    }
    s.server(DEFAULT_API)
}

fn write_settings(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(&dir), serde_json::to_string_pretty(s).unwrap()).map_err(|e| e.to_string())
}

fn key_ring() -> KeyRing {
    let mut ring = KeyRing::default();
    for (kid, key) in TRUSTED_KEYS {
        let _ = ring.add_b64(kid, key); // a placeholder key simply fails to load
    }
    if let Some((kid, key)) = TEST_TRUSTED_KEY.and_then(|k| k.split_once(':')) {
        if let Err(e) = ring.add_b64(kid, key) { eprintln!("Hashcoin Miner: HASHCOIN_TEST_TRUSTED_KEY is not a valid key ({e})"); }
    }
    // Development only: trust the local API's throwaway key. Never enabled in release builds.
    #[cfg(all(debug_assertions, feature = "dev-key"))]
    if let Ok(k) = std::env::var("HASHCOIN_DEV_PUBKEY") {
        match ring.add_b64("dev", &k) {
            Ok(()) => eprintln!("Hashcoin Miner: trusting the local API's dev key"),
            Err(e) => eprintln!("Hashcoin Miner: HASHCOIN_DEV_PUBKEY is not a valid key ({e})"),
        }
    }
    ring
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); }
}

/// Updates need the update key in tauri.conf.json (`plugins.updater.pubkey`); until it's set there's
/// nothing to verify an update against, so the app doesn't look for any.
fn updates_configured(app: &AppHandle) -> bool {
    app.config().plugins.0.get("updater").and_then(|u| u.get("pubkey")).and_then(|k| k.as_str())
        .is_some_and(|k| !k.is_empty() && !k.starts_with("REPLACE_"))
}

#[tauri::command]
fn status(rt: State<Shared>) -> Status { rt.lock().unwrap().status() }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo { version: String, test_build: bool, updates: bool, source_url: String, safety_url: String, av_help_url: String }

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(), test_build: TEST_TRUSTED_KEY.is_some(), updates: updates_configured(&app),
        source_url: SOURCE_URL.into(), safety_url: SAFETY_URL.into(), av_help_url: AV_HELP_URL.into(),
    }
}

/// "Not now" on the antivirus message: hide it, mining stays off.
#[tauri::command]
fn dismiss_blocked(rt: State<Shared>) -> Status {
    let mut r = rt.lock().unwrap();
    r.dismiss_blocked();
    r.status()
}

/// Open one of our two pages in the default browser (only these two, never a URL from the window).
#[tauri::command]
fn open_link(which: String) -> Result<(), String> {
    let url = match which.as_str() { "source" => SOURCE_URL, "avhelp" => AV_HELP_URL, "safety" => SAFETY_URL, _ => return Err("unknown link".into()) };
    if url.contains(".invalid") { return Err("That page isn't up yet.".into()); }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let (op, file) = (wide("open"), wide(url));
        // SAFETY: nul-terminated UTF-16 strings that outlive the call.
        let r = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
        if r as isize <= 32 { return Err(format!("Couldn't open {url}")); }
    }
    Ok(())
}

#[tauri::command]
fn save_wallet(rt: State<Shared>, app: AppHandle, address: String) -> Result<Status, String> {
    let address = address.trim().to_string();
    if !wallet::is_solana_address(&address) {
        return Err("That doesn't look like a Solana wallet address. Paste the public address (not your seed phrase or private key).".into());
    }
    let mut r = rt.lock().unwrap();
    let was_mining = r.mining;
    r.stop();
    r.settings.wallet = address;
    write_settings(&app, &r.settings)?;
    if was_mining { r.start()?; }
    Ok(r.status())
}

/// Save the options from the settings panel. The wallet, rig id and server stay as they are.
#[tauri::command]
fn save_settings(rt: State<Shared>, app: AppHandle, settings: Settings) -> Result<Status, String> {
    let mut r = rt.lock().unwrap();
    let next = Settings { wallet: r.settings.wallet.clone(), rig_id: r.settings.rig_id.clone(), api_override: r.settings.api_override.clone(), ..settings }.clamped();
    if next.start_with_windows != r.settings.start_with_windows {
        let login = app.autolaunch();
        let res = if next.start_with_windows { login.enable() } else { login.disable() };
        res.map_err(|e| format!("Couldn't change the Windows startup entry: {e}"))?;
    }
    write_settings(&app, &next)?;
    r.apply_settings(next);
    Ok(r.status())
}

/// Public data from the server for the window: `stats` (tax rate and split), `prices` (charts), or
/// `wallet` (this wallet's levels, balance, paid and pending). None when the server has nothing yet.
/// Runs off the main thread so a slow server doesn't freeze the window.
#[tauri::command]
async fn server_get(rt: State<'_, Shared>, what: String) -> Result<Option<serde_json::Value>, String> {
    let (base, wallet) = { let r = rt.lock().unwrap(); (r.api_base.clone(), r.settings.wallet.clone()) };
    let path = match what.as_str() {
        "stats" => "/v1/stats".to_string(),
        "prices" => "/v1/prices".to_string(),
        "wallet" if !wallet.is_empty() => format!("/v1/wallet/{wallet}"),
        "wallet" => return Ok(None),
        _ => return Err(format!("unknown request {what}")),
    };
    match ureq::get(&format!("{base}{path}")).timeout(Duration::from_secs(10)).call() {
        Ok(resp) => resp.into_json::<serde_json::Value>().map(Some).map_err(|e| e.to_string()),
        Err(ureq::Error::Status(404 | 503, _)) => Ok(None),
        Err(e) => Err(format!("server unreachable: {e}")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo { version: String, notes: Option<String> }

/// Ask the server for a newer version. The feed is signed with the update key, so the server can
/// only offer builds we signed.
#[tauri::command]
async fn check_update(app: AppHandle, rt: State<'_, Shared>, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    if !updates_configured(&app) { return Ok(None); }
    let base = rt.lock().unwrap().api_base.clone();
    let endpoint = format!("{base}/v1/app/update/") + "{{target}}/{{arch}}/{{current_version}}";
    let update = app.updater_builder()
        .endpoints(vec![endpoint.parse().map_err(|e| format!("bad update address: {e}"))?]).map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(20))
        .build().map_err(|e| e.to_string())?
        .check().await.map_err(|e| format!("update check failed: {e}"))?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() });
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// Download the update, check its signature, and run the installer. Miners stop first; the new
/// version picks mining up again if it was on.
#[tauri::command]
async fn install_update(app: AppHandle, rt: State<'_, Shared>, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("No update to install.")?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| format!("update download failed: {e}"))?;
    {
        let mut r = rt.lock().unwrap();
        if r.mining {
            if let Ok(dir) = app.path().app_config_dir() { let _ = std::fs::write(resume_flag(&dir), b""); }
        }
        r.stop();
    }
    update.install(bytes).map_err(|e| format!("update failed: {e}"))?;
    app.restart();
}

#[tauri::command]
fn detect(rt: State<Shared>) -> Status {
    let gpus = detect_gpus();
    let mut r = rt.lock().unwrap();
    r.set_gpus(gpus);
    r.status()
}

#[tauri::command]
fn start(rt: State<Shared>) -> Result<Status, String> {
    let mut r = rt.lock().unwrap();
    r.start()?;
    Ok(r.status())
}

#[tauri::command]
fn stop(rt: State<Shared>) -> Status {
    let mut r = rt.lock().unwrap();
    r.stop();
    r.status()
}

fn main() {
    tauri::Builder::default()
        // A second launch (e.g. the Start menu while the login entry already started it) just opens
        // the running app, so two copies never mine on the same cards.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Already running: a preview launch shows the message in the running app.
            if let Some((what, av)) = antivirus_preview(&args, PREVIEW_ALLOWED) {
                if let Some(rt) = app.try_state::<Shared>() { rt.lock().unwrap().preview_blocked(what, av); }
            }
            show_window(app)
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![AUTOSTART_ARG])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_local_data_dir()?;
            let settings = load_settings(&config_dir);
            let api = server(&settings);
            eprintln!("Hashcoin Miner: settings {} | server {api}", settings_path(&config_dir).display());
            let mut rt = Runtime::new(settings, api, key_ring(), data_dir);
            rt.set_gpus(detect_gpus());
            // Closed while starting a miner last time? Then explain before anything else.
            rt.check_start_marker();
            let args: Vec<String> = std::env::args().collect();
            if let Some((what, av)) = antivirus_preview(&args, PREVIEW_ALLOWED) { rt.preview_blocked(what, av); }

            // Mining starts only on the user's say-so: the Start button, "Start mining when Windows
            // starts" (which launches us with AUTOSTART_ARG), or mining being on before an update.
            let at_login = std::env::args().any(|a| a == AUTOSTART_ARG);
            let flag = resume_flag(&config_dir);
            let after_update = std::fs::metadata(&flag).and_then(|m| m.modified()).ok()
                .is_some_and(|t| SystemTime::now().duration_since(t).unwrap_or_default() < Duration::from_secs(600));
            let _ = std::fs::remove_file(&flag);
            // After a Defender block, never start by itself: the user reads the message and decides.
            let blocked = rt.status().blocked.is_some();
            if ((at_login && rt.settings.start_with_windows) || after_update) && !blocked {
                if let Err(e) = rt.start() { eprintln!("Hashcoin Miner: not starting ({e})"); }
            }
            let shared: Shared = Arc::new(Mutex::new(rt));
            app.manage(shared.clone());

            // Started at login: stay in the tray (unless there's a Defender message to show).
            // Otherwise show the window (hidden in the config so a login start doesn't flash it).
            if let Some(w) = app.get_webview_window("main") {
                if TEST_TRUSTED_KEY.is_some() { let _ = w.set_title("Hashcoin Miner (test build)"); }
                if !at_login || blocked { let _ = w.show(); }
            }

            // Background loop: check-ins, safety checks and miner supervision.
            // If Defender stops mining while the window is in the tray, open it so the user sees why.
            let bg = shared.clone();
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut was_blocked = blocked;
                loop {
                    let now_blocked = { let mut r = bg.lock().unwrap(); r.tick(); r.is_blocked() };
                    if now_blocked && !was_blocked { show_window(&handle); }
                    was_blocked = now_blocked;
                    std::thread::sleep(Duration::from_secs(5));
                }
            });

            // Tray: the always-visible sign that the app is running, with Start/Stop and Quit.
            let open = MenuItem::with_id(app, "open", "Open Hashcoin", true, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Start mining", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop mining", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit (stops mining)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &start, &stop, &quit])?;
            let tray_rt = shared.clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Hashcoin Miner")
                .menu(&menu)
                .on_menu_event(move |app, ev| match ev.id().as_ref() {
                    "open" => show_window(app),
                    "start" => { let _ = tray_rt.lock().unwrap().start(); }
                    "stop" => tray_rt.lock().unwrap().stop(),
                    "quit" => { tray_rt.lock().unwrap().stop(); app.exit(0); }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it to the tray; mining continues only if the user started it.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![status, app_info, dismiss_blocked, open_link, save_wallet, save_settings, detect, start, stop, server_get, check_update, install_update])
        .run(tauri::generate_context!())
        .expect("error while running Hashcoin Miner");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_builds_ignore_the_defender_preview() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let preview = args(&["hashcoin-miner.exe", "--show-defender-help"]);
        assert_eq!(antivirus_preview(&preview, false), None, "a release build shows nothing");
        assert_eq!(antivirus_preview(&args(&["x", "--show-defender-help=Avast"]), false), None);
        assert_eq!(antivirus_preview(&preview, true), Some(("miner", None)));
        assert_eq!(antivirus_preview(&args(&["x", "--show-defender-help=app"]), true), Some(("app", None)));
        assert_eq!(antivirus_preview(&args(&["x", "--show-defender-help=Avast"]), true), Some(("miner", Some("Avast".into()))));
        assert_eq!(antivirus_preview(&args(&["x", "--show-defender-help=Norton 360"]), true), Some(("miner", Some("Norton 360".into()))));
        assert_eq!(antivirus_preview(&args(&["x", "--show-defender-helpx"]), true), None);
        assert_eq!(antivirus_preview(&args(&["x", "--autostart"]), true), None);
        // What a release build is: no test key compiled in, not a debug build.
        assert_eq!(PREVIEW_ALLOWED, cfg!(debug_assertions) || option_env!("HASHCOIN_TEST_TRUSTED_KEY").is_some_and(|k| !k.is_empty()));
    }
}
