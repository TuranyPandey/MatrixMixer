//! What is playing on this PC and what it sounds like, for the now-playing
//! connector and the visualiser widget. Windows only; elsewhere both report nothing.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub playing: bool,
}

/// The media session Windows shows on its own volume flyout (Spotify, a browser tab, ...).
/// `None` when nothing has one.
#[cfg(windows)]
pub fn now_playing() -> Result<Option<NowPlaying>, String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    let text = |e: windows::core::Error| e.message().to_string();
    let manager = Manager::RequestAsync().map_err(text)?.join().map_err(text)?;
    // No session comes back as an error, not as null.
    let Ok(session) = manager.GetCurrentSession() else {
        return Ok(None);
    };
    let props = session.TryGetMediaPropertiesAsync().map_err(text)?.join().map_err(text)?;
    let playing = session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == Status::Playing)
        .unwrap_or(false);
    Ok(Some(NowPlaying {
        title: props.Title().map(|s| s.to_string()).unwrap_or_default(),
        artist: props.Artist().map(|s| s.to_string()).unwrap_or_default(),
        playing,
    }))
}

#[cfg(not(windows))]
pub fn now_playing() -> Result<Option<NowPlaying>, String> {
    Ok(None)
}

/// How many frequency bands the visualiser gets, bass first.
pub const BANDS: usize = 12;
/// Samples per analysis. At 48 kHz that is 43 ms of sound and 23 Hz per bin.
const WINDOW: usize = 2048;
/// The bands are spaced evenly in pitch between these two frequencies.
const LOW_HZ: f32 = 45.0;
const HIGH_HZ: f32 = 14_000.0;
/// Anything quieter than this (relative to full scale) draws as nothing.
const FLOOR_DB: f32 = -66.0;

/// In-place radix-2 FFT. `re.len()` must be a power of two.
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let angle = -2.0 * std::f32::consts::PI / len as f32;
        let (step_re, step_im) = (angle.cos(), angle.sin());
        for start in (0..n).step_by(len) {
            let (mut w_re, mut w_im) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let (t_re, t_im) = (re[b] * w_re - im[b] * w_im, re[b] * w_im + im[b] * w_re);
                re[b] = re[a] - t_re;
                im[b] = im[a] - t_im;
                re[a] += t_re;
                im[a] += t_im;
                let next = w_re * step_re - w_im * step_im;
                w_im = w_re * step_im + w_im * step_re;
                w_re = next;
            }
        }
        len <<= 1;
    }
}

/// Reduces the latest `WINDOW` mono samples to `BANDS` levels, 0-1 each, bass first.
/// A level is how loud the strongest tone in that band is, on a decibel scale.
fn spectrum(samples: &[f32], sample_rate: f32) -> [f32; BANDS] {
    let mut re = [0.0f32; WINDOW];
    let mut im = [0.0f32; WINDOW];
    let offset = WINDOW.saturating_sub(samples.len());
    for (i, sample) in samples.iter().rev().take(WINDOW).rev().enumerate() {
        // Hann window, so a tone between two bins does not smear across the display.
        let hann = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * (offset + i) as f32 / (WINDOW - 1) as f32).cos();
        re[offset + i] = sample * hann;
    }
    fft(&mut re, &mut im);

    let bin_hz = sample_rate / WINDOW as f32;
    let edge = |band: usize| LOW_HZ * (HIGH_HZ / LOW_HZ).powf(band as f32 / BANDS as f32);
    let mut bands = [0.0f32; BANDS];
    for (band, level) in bands.iter_mut().enumerate() {
        let first = ((edge(band) / bin_hz).round() as usize).clamp(1, WINDOW / 2 - 1);
        let last = ((edge(band + 1) / bin_hz).round() as usize).clamp(first + 1, WINDOW / 2);
        let peak = (first..last).map(|bin| (re[bin] * re[bin] + im[bin] * im[bin]).sqrt()).fold(0.0f32, f32::max);
        // A full-scale sine comes out of a Hann-windowed FFT at WINDOW / 4.
        let db = 20.0 * (peak / (WINDOW as f32 / 4.0)).max(1e-9).log10();
        // Music carries far less energy up high; lean the scale so treble still shows.
        let tilted = db + band as f32 * 1.5;
        *level = ((tilted - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0);
    }
    bands
}

/// The spectrum of whatever the default speakers are playing right now: `BANDS`
/// levels, 0-1, bass first. Empty until the listener has started. Listening
/// starts on the first call and stops by itself a few seconds after the calls stop.
/// Nothing is stored: each analysis replaces the last.
#[cfg(windows)]
pub fn bands() -> Vec<f32> {
    use std::sync::atomic::Ordering;
    if let Ok(mut asked) = listener::ASKED.lock() {
        *asked = Some(std::time::Instant::now());
    }
    if !listener::RUNNING.swap(true, Ordering::SeqCst) {
        std::thread::spawn(|| {
            if let Err(e) = listener::listen() {
                eprintln!("Visualiser stopped listening: {}", e.message());
            }
            if let Ok(mut latest) = listener::LATEST.lock() {
                latest.clear();
            }
            listener::RUNNING.store(false, Ordering::SeqCst);
        });
    }
    listener::LATEST.lock().map(|latest| latest.clone()).unwrap_or_default()
}

#[cfg(not(windows))]
pub fn bands() -> Vec<f32> {
    Vec::new()
}

#[cfg(windows)]
mod listener {
    use super::{spectrum, WINDOW};
    use std::collections::VecDeque;
    use std::sync::atomic::AtomicBool;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

    pub static RUNNING: AtomicBool = AtomicBool::new(false);
    pub static LATEST: Mutex<Vec<f32>> = Mutex::new(Vec::new());
    pub static ASKED: Mutex<Option<Instant>> = Mutex::new(None);

    /// "Record what this output device is playing" instead of a microphone.
    const STREAMFLAGS_LOOPBACK: u32 = 0x0002_0000;
    /// The packet is silence; its bytes are not meaningful.
    const BUFFERFLAGS_SILENT: u32 = 0x2;
    const ANALYSE_EVERY: Duration = Duration::from_millis(33);

    /// Nobody has asked for the spectrum for a while: time to stop listening.
    fn forgotten() -> bool {
        ASKED.lock().ok().and_then(|asked| *asked).map_or(true, |at| at.elapsed() > Duration::from_secs(3))
    }

    pub fn listen() -> windows::core::Result<()> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            while !forgotten() {
                // Open the speakers afresh every few seconds, in case headphones were plugged in.
                let device = devices.GetDefaultAudioEndpoint(eRender, eConsole)?;
                let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
                let format = client.GetMixFormat()?;
                // WAVEFORMATEX is a packed struct: copy the fields out before using them.
                let (channels, rate, bits) =
                    ((*format).nChannels as usize, (*format).nSamplesPerSec as f32, (*format).wBitsPerSample);
                let opened = client.Initialize(AUDCLNT_SHAREMODE_SHARED, STREAMFLAGS_LOOPBACK, 2_000_000, 0, format, None);
                CoTaskMemFree(Some(format as *const _));
                opened?;
                let capture: IAudioCaptureClient = client.GetService()?;
                client.Start()?;

                let mut recent: VecDeque<f32> = VecDeque::with_capacity(WINDOW);
                let mut heard = Instant::now();
                let mut analysed = Instant::now();
                let opened_at = Instant::now();
                while opened_at.elapsed() < Duration::from_secs(5) && !forgotten() {
                    std::thread::sleep(Duration::from_millis(10));
                    while capture.GetNextPacketSize()? > 0 {
                        let (mut data, mut frames, mut flags) = (std::ptr::null_mut::<u8>(), 0u32, 0u32);
                        capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
                        let silent = flags & BUFFERFLAGS_SILENT != 0 || data.is_null();
                        for frame in 0..frames as usize {
                            // Mix the channels down to one. Shared-mode mixes are 32-bit float; 16-bit is the old fallback.
                            let mut sum = 0.0f32;
                            if !silent {
                                for channel in 0..channels {
                                    let index = frame * channels + channel;
                                    sum += match bits {
                                        32 => (data as *const f32).add(index).read_unaligned(),
                                        16 => (data as *const i16).add(index).read_unaligned() as f32 / 32768.0,
                                        _ => 0.0,
                                    };
                                }
                            }
                            if recent.len() == WINDOW {
                                recent.pop_front();
                            }
                            recent.push_back(sum / channels.max(1) as f32);
                        }
                        capture.ReleaseBuffer(frames)?;
                        heard = Instant::now();
                    }
                    // When nothing plays, Windows sends no packets at all: let the old sound run out.
                    if heard.elapsed() > Duration::from_millis(150) {
                        recent.clear();
                    }
                    if analysed.elapsed() >= ANALYSE_EVERY {
                        analysed = Instant::now();
                        let bands = spectrum(recent.make_contiguous(), rate);
                        if let Ok(mut latest) = LATEST.lock() {
                            *latest = bands.to_vec();
                        }
                    }
                }
                let _ = client.Stop();
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{spectrum, BANDS, WINDOW};

    fn tone(hz: f32, amplitude: f32) -> Vec<f32> {
        (0..WINDOW).map(|i| amplitude * (2.0 * std::f32::consts::PI * hz * i as f32 / 48_000.0).sin()).collect()
    }

    fn loudest(bands: &[f32]) -> usize {
        (0..bands.len()).max_by(|&a, &b| bands[a].total_cmp(&bands[b])).unwrap()
    }

    #[test]
    fn a_tone_lands_in_its_band() {
        let bass = spectrum(&tone(50.0, 0.5), 48_000.0);
        let mid = spectrum(&tone(1000.0, 0.5), 48_000.0);
        let treble = spectrum(&tone(10_000.0, 0.5), 48_000.0);
        assert_eq!(loudest(&bass), 0);
        assert!((5..=7).contains(&loudest(&mid)), "1 kHz landed in band {}", loudest(&mid));
        assert!(loudest(&treble) >= BANDS - 2);
        // Bands far from the tone stay dark.
        assert!(mid[0] < 0.2 && mid[BANDS - 1] < 0.2, "{mid:?}");
    }

    #[test]
    fn silence_is_dark_and_louder_is_taller() {
        assert!(spectrum(&[], 48_000.0).iter().all(|&level| level == 0.0));
        assert!(spectrum(&vec![0.0; WINDOW], 48_000.0).iter().all(|&level| level == 0.0));
        let quiet = spectrum(&tone(1000.0, 0.01), 48_000.0);
        let loud = spectrum(&tone(1000.0, 0.8), 48_000.0);
        assert!(loud[loudest(&loud)] > quiet[loudest(&quiet)] + 0.3);
        assert!(loud.iter().all(|&level| (0.0..=1.0).contains(&level)));
    }

    /// Needs a desktop session with sound, so it is not part of the normal run:
    /// `cargo test media -- --ignored --nocapture`. Plays a one-second 1 kHz beep.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn reads_this_pc() {
        println!("now playing: {:?}", super::now_playing().expect("media session lookup"));
        println!("on air: {:?}", crate::onair::in_use());
        super::bands();
        std::thread::sleep(std::time::Duration::from_millis(400));
        let beep = std::thread::spawn(|| {
            let _ = std::process::Command::new("powershell").args(["-NoProfile", "-Command", "[console]::beep(1000, 1200)"]).status();
        });
        let mut best = vec![0.0f32; BANDS];
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let now = super::bands();
            if now.iter().cloned().fold(0.0, f32::max) > best.iter().cloned().fold(0.0, f32::max) {
                best = now;
            }
        }
        beep.join().unwrap();
        println!("loudest spectrum during the beep: {best:?}");
        assert_eq!(best.len(), BANDS);
        assert!((5..=7).contains(&loudest(&best)), "the 1 kHz beep should peak in the middle bands");
    }
}
