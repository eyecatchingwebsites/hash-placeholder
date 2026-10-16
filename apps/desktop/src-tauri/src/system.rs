//! What the safety guard needs to know about the PC: how long since the last input, whether an app
//! is fullscreen, and how hot each NVIDIA card is. Windows APIs only; elsewhere these report nothing.

use std::collections::HashMap;
use std::time::Duration;

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

/// Temperature (°C) per nvidia-smi index.
pub fn nvidia_temps() -> HashMap<u32, u32> {
    let mut cmd = std::process::Command::new("nvidia-smi");
    cmd.args(["--query-gpu=index,temperature.gpu", "--format=csv,noheader,nounits"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.output().map(|o| parse_temps(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
}

fn parse_temps(out: &str) -> HashMap<u32, u32> {
    out.lines()
        .filter_map(|l| {
            let (i, t) = l.split_once(',')?;
            Some((i.trim().parse().ok()?, t.trim().parse().ok()?))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_nvidia_smi_temps() {
        let t = super::parse_temps("0, 71\r\n1, [N/A]\n");
        assert_eq!(t.get(&0), Some(&71));
        assert_eq!(t.len(), 1);
    }
}
