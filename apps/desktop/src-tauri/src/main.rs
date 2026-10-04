#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;

use hashcoin_core::{wallet, KeyRing};
use runtime::{detect_gpus, Runtime, Settings, Status};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State,
};

/// Public keys the app trusts for signed assignments and miner lists. Replace before release with
/// the production key from the deploy environment (only the public half goes in the app).
const TRUSTED_KEYS: &[(&str, &str)] = &[("prod-1", "REPLACE_WITH_PRODUCTION_PUBLIC_KEY")];
const DEFAULT_API: &str = "https://api.hashcoin.invalid";

type Shared = Arc<Mutex<Runtime>>;

fn settings_path(dir: &Path) -> PathBuf { dir.join("settings.json") }

fn load_settings(dir: &Path) -> Settings {
    let mut s: Settings = std::fs::read_to_string(settings_path(dir)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    if s.rig_id.is_empty() {
        let host = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
        s.rig_id = wallet::rig_id_from_hostname(&host);
    }
    if s.api_base.is_empty() { s.api_base = DEFAULT_API.into(); }
    // Development only: point a debug build at a local API without editing the settings file.
    #[cfg(all(debug_assertions, feature = "dev-key"))]
    if let Ok(api) = std::env::var("HASHCOIN_API") {
        s.api_base = api;
    }
    s
}

fn key_ring() -> KeyRing {
    let mut ring = KeyRing::default();
    for (kid, key) in TRUSTED_KEYS {
        let _ = ring.add_b64(kid, key); // a placeholder key simply fails to load
    }
    // Development only: trust the local API's throwaway key. Never enabled in release builds.
    #[cfg(all(debug_assertions, feature = "dev-key"))]
    if let Ok(k) = std::env::var("HASHCOIN_DEV_PUBKEY") {
        let _ = ring.add_b64("dev", &k);
    }
    ring
}

#[tauri::command]
fn status(rt: State<Shared>) -> Status { rt.lock().unwrap().status() }

#[tauri::command]
fn save_wallet(rt: State<Shared>, app: tauri::AppHandle, address: String) -> Result<Status, String> {
    let address = address.trim().to_string();
    if !wallet::is_solana_address(&address) {
        return Err("That doesn't look like a Solana wallet address. Paste the public address (not your seed phrase or private key).".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut r = rt.lock().unwrap();
    let was_mining = r.mining;
    r.stop();
    r.settings.wallet = address;
    std::fs::write(settings_path(&dir), serde_json::to_string_pretty(&r.settings).unwrap()).map_err(|e| e.to_string())?;
    if was_mining { r.start()?; }
    Ok(r.status())
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
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_local_data_dir()?;
            let settings = load_settings(&config_dir);
            eprintln!("Hashcoin Miner: settings {} | server {}", settings_path(&config_dir).display(), settings.api_base);
            let mut rt = Runtime::new(settings, key_ring(), data_dir);
            rt.set_gpus(detect_gpus());
            let shared: Shared = Arc::new(Mutex::new(rt));
            app.manage(shared.clone());

            // Background loop: check-ins and miner supervision. Mining only starts when the user clicks Start.
            let bg = shared.clone();
            std::thread::spawn(move || loop {
                bg.lock().unwrap().tick();
                std::thread::sleep(Duration::from_secs(5));
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
                    "open" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
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
        .invoke_handler(tauri::generate_handler![status, save_wallet, detect, start, stop])
        .run(tauri::generate_context!())
        .expect("error while running Hashcoin Miner");
}
