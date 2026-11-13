//! Is the microphone or camera in use right now? For the on-air light.
//!
//! Windows keeps a record per app under the privacy "ConsentStore": while an app
//! holds the device, its `LastUsedTimeStop` is 0. This reads that with `reg query`,
//! the same record the taskbar's microphone icon is driven by.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, Default)]
pub struct InUse {
    pub mic: bool,
    pub camera: bool,
}

/// True if any line of `reg query ... /v LastUsedTimeStop` output shows a zero stop time.
fn any_open(output: &str) -> bool {
    output.lines().any(|line| {
        let mut words = line.split_whitespace();
        words.next() == Some("LastUsedTimeStop") && words.next_back() == Some("0x0")
    })
}

#[cfg(windows)]
fn device_in_use(device: &str) -> bool {
    use std::os::windows::process::CommandExt;
    let key = format!(r"HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{device}");
    std::process::Command::new("reg")
        .args(["query", &key, "/s", "/v", "LastUsedTimeStop"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map(|out| any_open(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or(false)
}

#[cfg(windows)]
pub fn in_use() -> InUse {
    InUse { mic: device_in_use("microphone"), camera: device_in_use("webcam") }
}

#[cfg(not(windows))]
pub fn in_use() -> InUse {
    InUse::default()
}

#[cfg(test)]
mod tests {
    use super::any_open;

    #[test]
    fn zero_stop_time_means_in_use() {
        let idle = "HKEY_CURRENT_USER\\...\\microphone\\App\n    LastUsedTimeStop    REG_QWORD    0x1dd617d2f1aba8c\n";
        let live = "HKEY_CURRENT_USER\\...\\microphone\\App\n    LastUsedTimeStop    REG_QWORD    0x0\n";
        assert!(!any_open(idle));
        assert!(any_open(live));
        assert!(!any_open(""));
    }
}
