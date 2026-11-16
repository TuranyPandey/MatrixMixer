//! The system microphone's mute switch: the one in Windows' sound settings, which
//! silences the microphone for every app at once. For the "Mute microphone"
//! button action and the on-air light's MUTE state. Windows only.
//!
//! This is not the mute button inside Teams, Zoom or Discord: those keep their
//! own state and cannot be read from outside.

/// Whether the default microphone is muted. `None` if there is no microphone.
#[cfg(windows)]
pub fn muted() -> Option<bool> {
    unsafe { endpoints().first().and_then(|mic| mic.GetMute().ok()).map(|m| m.as_bool()) }
}

/// Flips the mute switch and returns the new state (true = muted).
#[cfg(windows)]
pub fn toggle() -> Result<bool, String> {
    unsafe {
        let mics = endpoints();
        let first = mics.first().ok_or("No microphone found")?;
        let mute = !first.GetMute().map_err(|e| e.message().to_string())?.as_bool();
        // The device used for calls and the one used for everything else can differ: keep them in step.
        for mic in &mics {
            mic.SetMute(mute, std::ptr::null()).map_err(|e| e.message().to_string())?;
        }
        Ok(mute)
    }
}

/// The default microphones: for calls first, then for everything else.
#[cfg(windows)]
unsafe fn endpoints() -> Vec<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eCapture, eCommunications, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else {
            return Vec::new();
        };
        [eCommunications, eConsole]
            .into_iter()
            .filter_map(|role| devices.GetDefaultAudioEndpoint(eCapture, role).ok())
            .filter_map(|device| device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok())
            .collect()
    }
}

#[cfg(not(windows))]
pub fn muted() -> Option<bool> {
    None
}

#[cfg(not(windows))]
pub fn toggle() -> Result<bool, String> {
    Err("Muting the microphone is only supported on Windows for now.".into())
}

#[cfg(all(test, windows))]
mod tests {
    /// Flips the real microphone's mute switch and puts it back. Run by hand:
    /// `cargo test mic -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn toggles_and_restores() {
        let Some(before) = super::muted() else {
            println!("no microphone on this PC");
            return;
        };
        println!("muted before: {before}");
        assert_eq!(super::toggle().unwrap(), !before);
        assert_eq!(super::muted(), Some(!before));
        assert_eq!(super::toggle().unwrap(), before);
        assert_eq!(super::muted(), Some(before));
    }
}
