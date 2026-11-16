//! Things a Glyph Button press can do on the PC.

use std::process::Command;

/// Runs one action. `kind` is one of the names below; `arg` is only used by `command`.
pub fn run(kind: &str, arg: Option<String>) -> Result<(), String> {
    match kind {
        "play_pause" => keys::tap(&[keys::MEDIA_PLAY_PAUSE]),
        "next_track" => keys::tap(&[keys::MEDIA_NEXT]),
        "previous_track" => keys::tap(&[keys::MEDIA_PREVIOUS]),
        "mute_volume" => keys::tap(&[keys::VOLUME_MUTE]),
        // The app normally calls mic_toggle itself so it can show the new state; this is the same switch.
        "mute_mic" => crate::mic::toggle().map(|_| ()),
        "lock" => lock(),
        "command" => {
            let command = arg.unwrap_or_default();
            if command.trim().is_empty() {
                return Err("No command set for this button".into());
            }
            shell(&command)
        }
        other => Err(format!("Unknown action \"{other}\"")),
    }
}

fn spawn(program: &str, args: &[&str]) -> Result<(), String> {
    Command::new(program).args(args).spawn().map(|_| ()).map_err(|e| format!("Could not run {program}: {e}"))
}

#[cfg(windows)]
fn shell(command: &str) -> Result<(), String> {
    spawn("cmd", &["/C", command])
}

#[cfg(not(windows))]
fn shell(command: &str) -> Result<(), String> {
    spawn("sh", &["-c", command])
}

#[cfg(windows)]
fn lock() -> Result<(), String> {
    spawn("rundll32.exe", &["user32.dll,LockWorkStation"])
}

#[cfg(target_os = "macos")]
fn lock() -> Result<(), String> {
    spawn("pmset", &["displaysleepnow"])
}

#[cfg(all(unix, not(target_os = "macos")))]
fn lock() -> Result<(), String> {
    spawn("loginctl", &["lock-session"])
}

/// Virtual key presses. Only implemented on Windows so far.
mod keys {
    pub const MEDIA_NEXT: u8 = 0xB0;
    pub const MEDIA_PREVIOUS: u8 = 0xB1;
    pub const MEDIA_PLAY_PAUSE: u8 = 0xB3;
    pub const VOLUME_MUTE: u8 = 0xAD;

    /// Presses the keys in order, then releases them in reverse, like a hand would.
    #[cfg(windows)]
    pub fn tap(keys: &[u8]) -> Result<(), String> {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP};
        // Safety: keybd_event takes plain values and has no memory-safety preconditions.
        unsafe {
            for &key in keys {
                keybd_event(key, 0, 0, 0);
            }
            for &key in keys.iter().rev() {
                keybd_event(key, 0, KEYEVENTF_KEYUP, 0);
            }
        }
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn tap(_keys: &[u8]) -> Result<(), String> {
        Err("Media and shortcut keys are only supported on Windows for now. Use a custom command instead.".into())
    }
}
