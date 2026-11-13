//! The native half of the desktop app. Deliberately small: the window (React +
//! TypeScript) does the rendering and talks to the phone. Rust only covers what
//! a web page cannot do: find phones, press keys, read CPU load, serve the local API.

mod actions;
mod api;
mod discovery;
mod github;
mod stats;

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
            let show = MenuItem::with_id(app, "show", "Open Matrix Bridge", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Matrix Bridge")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
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
            pc_name
        ])
        .build(tauri::generate_context!())
        .expect("error while building Matrix Bridge");

    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            api::forget_info();
        }
    });
}
