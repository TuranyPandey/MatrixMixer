//! The native half of the desktop app. Deliberately small: the window (React +
//! TypeScript) does the rendering and talks to the phone. Rust only covers what
//! a web page cannot do: find phones, press keys, read CPU load, serve the local API.

mod actions;
mod api;
mod discovery;
mod fetch;
mod github;
mod media;
mod onair;
mod stats;

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};

/// Shared with the API thread.
struct ApiState {
    info: api::ApiInfo,
    status: Arc<Mutex<String>>,
}

/// Looks for phones on the network for a couple of seconds.
#[tauri::command]
async fn discover() -> Result<Vec<discovery::Found>, String> {
    tauri::async_runtime::spawn_blocking(|| discovery::discover(Duration::from_millis(1800)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn system_stats(stats: State<'_, stats::Stats>) -> stats::Sample {
    stats.sample()
}

/// Performs a Glyph Button action. See actions.rs for the names.
#[tauri::command]
fn run_action(kind: String, arg: Option<String>) -> Result<(), String> {
    actions::run(&kind, arg)
}

/// Read-only GitHub lookup for the GitHub connector. See github.rs for what is allowed.
#[tauri::command]
async fn github_get(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || github::get(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// The track Windows knows about, for the now-playing connector. See media.rs.
#[tauri::command]
async fn now_playing() -> Result<Option<media::NowPlaying>, String> {
    tauri::async_runtime::spawn_blocking(media::now_playing).await.map_err(|e| e.to_string())?
}

/// The spectrum of what the speakers are playing, for the visualiser widget. See media.rs.
#[tauri::command]
fn audio_bands() -> Vec<f32> {
    media::bands()
}

/// Whether the microphone or camera is in use, for the on-air light. See onair.rs.
#[tauri::command]
async fn on_air() -> Result<onair::InUse, String> {
    tauri::async_runtime::spawn_blocking(onair::in_use).await.map_err(|e| e.to_string())
}

/// Downloads an https link as text, for the calendar and ticker. See fetch.rs.
#[tauri::command]
async fn fetch_text(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fetch::text(&url)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn api_info(state: State<'_, ApiState>) -> api::ApiInfo {
    state.info.clone()
}

/// The window reports its connection state here so `GET /status` can answer.
#[tauri::command]
fn set_status(state: State<'_, ApiState>, status: String) {
    if let Ok(mut current) = state.status.lock() {
        *current = status;
    }
}

/// This computer's name, shown on the phone's list of paired PCs.
#[tauri::command]
fn pc_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC".to_string())
}

/// Island sizes in logical pixels: the resting pill, the hover panel, and the
/// hover panel on its Widgets tab, which needs more room.
const ISLAND_COMPACT: (f64, f64) = (250.0, 42.0);
const ISLAND_EXPANDED: (f64, f64) = (400.0, 232.0);
const ISLAND_TALL: (f64, f64) = (400.0, 282.0);
/// Gap between the island and the edge of the screen, in logical pixels.
const ISLAND_MARGIN: f64 = 8.0;

/// Where the island sits: 0-2 along the top (left, centre, right), 3-5 along the bottom.
static ISLAND_PLACE: AtomicU8 = AtomicU8::new(1);

/// Sizes the island and pins it to its place on the main screen, clear of the taskbar.
/// The hover panel grows away from the edge it is pinned to.
fn place_island(window: &tauri::WebviewWindow, expanded: bool, tall: bool) {
    let (w, h) = match (expanded, tall) {
        (false, _) => ISLAND_COMPACT,
        (true, false) => ISLAND_EXPANDED,
        (true, true) => ISLAND_TALL,
    };
    let _ = window.set_size(tauri::LogicalSize::new(w, h));
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (left, top) = (area.position.x as f64, area.position.y as f64);
        let (free_w, free_h) = (area.size.width as f64 - w * scale, area.size.height as f64 - h * scale);
        let margin = ISLAND_MARGIN * scale;
        let place = ISLAND_PLACE.load(Ordering::SeqCst);
        let x = match place % 3 {
            0 => left + margin,
            1 => left + free_w / 2.0,
            _ => left + free_w - margin,
        };
        let y = if place < 3 { top + margin } else { top + free_h - margin };
        let _ = window.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
}

/// Shows or hides the island. The main window calls this from its "Island on the desktop" setting.
#[tauri::command]
fn island_show(app: tauri::AppHandle, visible: bool, place: u8) {
    ISLAND_PLACE.store(place.min(5), Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("island") {
        if visible {
            place_island(&window, false, false);
            let _ = window.show();
        } else {
            let _ = window.hide();
        }
    }
}

/// True while the island's hover panel is open.
static ISLAND_OPEN: AtomicBool = AtomicBool::new(false);

/// Grows the island into its hover panel, or shrinks it back to the pill.
/// Called again with a different `tall` when the panel changes tab.
#[tauri::command]
fn island_expand(app: tauri::AppHandle, expanded: bool, tall: Option<bool>) {
    let Some(window) = app.get_webview_window("island") else { return };
    place_island(&window, expanded, tall.unwrap_or(false));
    if ISLAND_OPEN.swap(expanded, Ordering::SeqCst) || !expanded {
        return;
    }
    // The webview does not always hear the pointer leave a window this small,
    // so while the panel is open, watch the pointer from here and tell it.
    std::thread::spawn(move || {
        let mut was_inside = true;
        while ISLAND_OPEN.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(150));
            let (Ok(cursor), Ok(pos), Ok(size)) = (window.cursor_position(), window.outer_position(), window.outer_size()) else {
                continue;
            };
            let inside = cursor.x >= pos.x as f64
                && cursor.y >= pos.y as f64
                && cursor.x < pos.x as f64 + size.width as f64
                && cursor.y < pos.y as f64 + size.height as f64;
            if inside != was_inside {
                was_inside = inside;
                let _ = window.emit("island-pointer", inside);
            }
        }
    });
}

/// Passed by the "Start with Windows" entry so the app comes up in the tray, not in your face.
const HIDDEN_FLAG: &str = "--hidden";

/// Whether the app starts when you sign in to Windows.
#[tauri::command]
fn autostart_get(app: tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let auto = app.autolaunch();
    if enabled { auto.enable() } else { auto.disable() }.map_err(|e| e.to_string())
}

/// Shows a Windows notification. Used when a timer runs out or changes phase.
#[tauri::command]
fn desktop_notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_main(app: tauri::AppHandle) {
    show_main_window(&app);
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Must be first. Launching a second copy (say, from the desktop shortcut while
        // the app sits in the tray) brings up the window of the one already running.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_FLAG]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_websocket::init())
        .manage(stats::Stats::new())
        .setup(|app| {
            // Local API. If it cannot start, the app still works; only the CLI hand-off is lost.
            let token = api::new_token();
            let status = Arc::new(Mutex::new(r#"{"ok":true,"state":"starting"}"#.to_string()));
            let handle = app.handle().clone();
            let port = api::start(token.clone(), status.clone(), move |request| {
                let _ = handle.emit("api-request", request);
            })
            .unwrap_or_else(|e| {
                eprintln!("{e}");
                0
            });
            let info = api::ApiInfo { port, token };
            if port != 0 {
                if let Err(e) = api::write_info(&info) {
                    eprintln!("Could not write api.json: {e}");
                }
            }
            app.manage(ApiState { info, status });

            // Tray icon: closing the window keeps widgets and the API running.
            let show = MenuItem::with_id(app, "show", "Open MatrixMixer", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let island = MenuItem::with_id(app, "island", "Show or hide the island", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &island, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("MatrixMixer")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    // The setting lives in the main window, so it does the flipping.
                    "island" => {
                        let _ = app.emit("island-toggle", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // The main window is created hidden (tauri.conf.json) so a start at sign-in never flashes it.
            if !std::env::args().any(|arg| arg == HIDDEN_FLAG) {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide to the tray instead of quitting. "Quit" in the tray menu really exits.
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            discover,
            system_stats,
            run_action,
            github_get,
            api_info,
            set_status,
            pc_name,
            now_playing,
            audio_bands,
            on_air,
            fetch_text,
            island_show,
            island_expand,
            show_main,
            autostart_get,
            autostart_set,
            desktop_notify
        ])
        .build(tauri::generate_context!())
        .expect("error while building MatrixMixer");

    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            api::forget_info();
        }
    });
}
