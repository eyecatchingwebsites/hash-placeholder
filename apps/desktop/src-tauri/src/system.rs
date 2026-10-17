//! What the app needs to know about the PC: the graphics cards, how hot each NVIDIA card is, how
//! long since the last input, and whether an app is fullscreen. Windows APIs only, read in-process:
//! the app starts no helper programs (no PowerShell, no nvidia-smi), so the verified miner is the
//! only program it ever runs. Elsewhere these report nothing.

use hashcoin_core::Gpu;
use std::collections::HashMap;
use std::time::Duration;

/// NVIDIA cards, numbered like nvidia-smi and the miners' `--gpu` flag (PCI bus order).
pub fn nvidia_gpus() -> Vec<Gpu> {
    #[cfg(windows)]
    if let Some(api) = nvml::api() {
        return api.gpus();
    }
    Vec::new()
}

/// Temperature (°C) per NVIDIA card index.
pub fn nvidia_temps() -> HashMap<u32, u32> {
    #[cfg(windows)]
    if let Some(api) = nvml::api() {
        return api.temps();
    }
    HashMap::new()
}

/// The names of the PC's graphics adapters, from DirectX (software renderers left out).
#[cfg(windows)]
pub fn display_adapters() -> Vec<String> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    let mut names = Vec::new();
    // SAFETY: DXGI calls on a factory we own; the description is a fixed, nul-padded array.
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return names };
        let mut i = 0;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            i += 1;
            let Ok(d) = adapter.GetDesc1() else { continue };
            if d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 { continue; }
            let len = d.Description.iter().position(|&c| c == 0).unwrap_or(d.Description.len());
            names.push(String::from_utf16_lossy(&d.Description[..len]));
        }
    }
    names
}

#[cfg(not(windows))]
pub fn display_adapters() -> Vec<String> { Vec::new() }

/// NVIDIA's management library (nvml.dll, installed with the driver), loaded from System32 only.
#[cfg(windows)]
mod nvml {
    use super::*;
    use hashcoin_core::Vendor;
    use std::ffi::c_void;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32};

    type Device = *mut c_void;

    #[repr(C)]
    #[derive(Default)]
    struct Memory { total: u64, free: u64, used: u64 }

    type InitFn = unsafe extern "C" fn() -> i32;
    type CountFn = unsafe extern "C" fn(*mut u32) -> i32;
    type HandleFn = unsafe extern "C" fn(u32, *mut Device) -> i32;
    type NameFn = unsafe extern "C" fn(Device, *mut u8, u32) -> i32;
    type MemoryFn = unsafe extern "C" fn(Device, *mut Memory) -> i32;
    type TemperatureFn = unsafe extern "C" fn(Device, u32, *mut u32) -> i32;

    pub struct Api { count: CountFn, handle: HandleFn, name: NameFn, memory: MemoryFn, temperature: TemperatureFn }

    pub fn api() -> Option<&'static Api> {
        static API: OnceLock<Option<Api>> = OnceLock::new();
        API.get_or_init(load).as_ref()
    }

    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }

    fn load() -> Option<Api> {
        // SAFETY: the library stays loaded for the life of the process, and each symbol is cast to
        // the signature NVML documents for it.
        unsafe {
            let mut lib = LoadLibraryExW(wide("nvml.dll").as_ptr(), std::ptr::null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32);
            if lib.is_null() {
                // Older drivers keep it next to nvidia-smi. A full path, so nothing else is searched.
                let pf = std::env::var("ProgramW6432").or_else(|_| std::env::var("ProgramFiles")).ok()?;
                lib = LoadLibraryExW(wide(&format!(r"{pf}\NVIDIA Corporation\NVSMI\nvml.dll")).as_ptr(), std::ptr::null_mut(), 0);
            }
            if lib.is_null() { return None; }
            macro_rules! sym {
                ($name:literal as $t:ty) => {
                    std::mem::transmute::<unsafe extern "system" fn() -> isize, $t>(GetProcAddress(lib, concat!($name, "\0").as_ptr())?)
                };
            }
            let init = sym!("nvmlInit_v2" as InitFn);
            if init() != 0 { return None; }
            Some(Api {
                count: sym!("nvmlDeviceGetCount_v2" as CountFn),
                handle: sym!("nvmlDeviceGetHandleByIndex_v2" as HandleFn),
                name: sym!("nvmlDeviceGetName" as NameFn),
                memory: sym!("nvmlDeviceGetMemoryInfo" as MemoryFn),
                temperature: sym!("nvmlDeviceGetTemperature" as TemperatureFn),
            })
        }
    }

    impl Api {
        fn devices(&self) -> Vec<(u32, Device)> {
            // SAFETY: NVML is initialised and thread-safe; out-parameters are locals.
            unsafe {
                let mut n = 0;
                if (self.count)(&mut n) != 0 { return Vec::new(); }
                (0..n).filter_map(|i| {
                    let mut d: Device = std::ptr::null_mut();
                    ((self.handle)(i, &mut d) == 0).then_some((i, d))
                }).collect()
            }
        }

        pub fn gpus(&self) -> Vec<Gpu> {
            self.devices().into_iter().map(|(index, d)| {
                let mut buf = [0u8; 96];
                let mut mem = Memory::default();
                // SAFETY: as above; the name buffer's length is passed in.
                let (name_ok, mem_ok) = unsafe { ((self.name)(d, buf.as_mut_ptr(), buf.len() as u32) == 0, (self.memory)(d, &mut mem) == 0) };
                let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                let name = if name_ok { String::from_utf8_lossy(&buf[..len]).into_owned() } else { "NVIDIA GPU".into() };
                Gpu { index, name, vendor: Vendor::Nvidia, memory_mb: mem_ok.then_some((mem.total / (1024 * 1024)) as u32) }
            }).collect()
        }

        pub fn temps(&self) -> HashMap<u32, u32> {
            self.devices().into_iter().filter_map(|(i, d)| {
                let mut t = 0;
                // SAFETY: as above. Sensor 0 = the GPU die.
                (unsafe { (self.temperature)(d, 0, &mut t) } == 0).then_some((i, t))
            }).collect()
        }
    }
}

/// The antivirus that's active, by name, from Windows Security Center (read-only). None when it
/// can't be read in a few seconds; the window then says "your antivirus".
pub fn active_antivirus() -> Option<String> {
    #[cfg(windows)]
    {
        // WMI on its own short-lived thread, so a slow Security Center never holds up the app.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || { let _ = tx.send(antivirus_products()); });
        rx.recv_timeout(Duration::from_secs(5)).ok().and_then(|p| hashcoin_core::antivirus::active(&p))
    }
    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
fn antivirus_products() -> Vec<hashcoin_core::antivirus::Product> {
    #[derive(serde::Deserialize)]
    #[serde(rename = "AntiVirusProduct", rename_all = "camelCase")]
    struct Row { display_name: String, product_state: u32 }
    let Ok(con) = wmi::WMIConnection::with_namespace_path(r"root\SecurityCenter2") else { return Vec::new() };
    con.query::<Row>().map(|rows| rows.into_iter().map(|r| hashcoin_core::antivirus::Product { name: r.display_name, state: r.product_state }).collect()).unwrap_or_default()
}

/// Time since the last keyboard or mouse input in this user's session.
#[cfg(windows)]
pub fn idle_time() -> Option<Duration> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: plain Win32 calls with a correctly sized struct.
    unsafe {
        if GetLastInputInfo(&mut info) == 0 { return None; }
        Some(Duration::from_millis(GetTickCount().wrapping_sub(info.dwTime) as u64))
    }
}

/// True while a game or other app fills the screen: Windows' own "busy / fullscreen Direct3D" state,
/// or a foreground window covering its whole monitor (borderless fullscreen games).
#[cfg(windows)]
pub fn fullscreen_app() -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, IsIconic};
    // SAFETY: plain Win32 calls; every out-parameter is a correctly sized local.
    unsafe {
        let mut state = 0;
        if SHQueryUserNotificationState(&mut state) == 0 && [QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE].contains(&state) {
            return true;
        }
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() || IsIconic(hwnd) != 0 { return false; }
        // The desktop and the taskbar cover the screen too, but aren't an app.
        let mut class = [0u16; 64];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32).max(0) as usize;
        let class = String::from_utf16_lossy(&class[..n]);
        if ["Progman", "WorkerW", "Shell_TrayWnd", "Windows.UI.Core.CoreWindow"].contains(&class.as_str()) { return false; }
        let mut win: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut win) == 0 { return false; }
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut mi) == 0 { return false; }
        let m = mi.rcMonitor;
        win.left <= m.left && win.top <= m.top && win.right >= m.right && win.bottom >= m.bottom
    }
}

#[cfg(not(windows))]
pub fn idle_time() -> Option<Duration> { None }

#[cfg(not(windows))]
pub fn fullscreen_app() -> bool { false }

#[cfg(all(test, windows))]
mod tests {
    /// Reads this PC's real cards (whatever they are); checks the calls work and agree.
    #[test]
    fn reads_cards_without_helper_programs() {
        let nvidia = super::nvidia_gpus();
        let temps = super::nvidia_temps();
        for g in &nvidia {
            assert!(!g.name.is_empty());
            assert!(temps.get(&g.index).is_some_and(|&t| t > 0 && t < 120), "{g:?} {temps:?}");
        }
        // Security Center answers with this PC's antivirus (or nothing); either way, quickly.
        let t = std::time::Instant::now();
        let av = super::active_antivirus();
        assert!(t.elapsed() < std::time::Duration::from_secs(6));
        eprintln!("active antivirus: {av:?}");
        let adapters = super::display_adapters();
        for g in &nvidia {
            assert!(adapters.iter().any(|a| a == &g.name), "DirectX and NVML name {} the same: {adapters:?}", g.name);
        }
    }
}
