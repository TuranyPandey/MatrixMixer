//! The local HTTP API that scripts and the `matrix` CLI talk to.
//!
//! It only listens on 127.0.0.1 and every request needs the bearer token from
//! `~/.matrix-bridge/api.json`. Requests are not handled here: they are passed
//! to the window, which owns rendering and the phone connection.

use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Response, Server};

pub const DEFAULT_PORT: u16 = 8766;
/// Largest request body accepted. A frame is ~2.5 KB; images can be bigger.
const MAX_BODY: u64 = 8 * 1024 * 1024;

/// One accepted request, as handed to the window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    /// `/text`, `/notify`, `/frame`, `/image`, `/clear` or `/brightness`.
    pub path: String,
    /// Raw query string without the `?`, e.g. `invert=1`.
    pub query: String,
    /// JSON body as text. Empty for `/image`.
    pub body: String,
    /// Image bytes for `/image`, base64. Empty otherwise.
    pub body_base64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiInfo {
    pub port: u16,
    pub token: String,
}

pub fn new_token() -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(40).map(char::from).collect()
}

/// Where Matrix Bridge keeps its files on this PC.
pub fn config_dir() -> PathBuf {
    if let Some(custom) = std::env::var_os("MATRIX_BRIDGE_HOME") {
        return PathBuf::from(custom);
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".matrix-bridge")
}

/// Tells the CLI where the API is. Removed again by `forget_info` on exit.
pub fn write_info(info: &ApiInfo) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("api.json"), serde_json::to_string_pretty(info).unwrap_or_default())
}

pub fn forget_info() {
    let _ = std::fs::remove_file(config_dir().join("api.json"));
}

fn json(status: u16, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("static header");
    Response::from_string(body).with_status_code(status).with_header(header)
}

/// Starts the server on a background thread and returns the port it got.
/// `status` is the JSON that `GET /status` answers with; the window keeps it up to date.
pub fn start(
    token: String,
    status: Arc<Mutex<String>>,
    on_request: impl Fn(ApiRequest) + Send + 'static,
) -> Result<u16, String> {
    // If the usual port is taken (a second copy of the app, say), let the OS pick one.
    let server = Server::http(("127.0.0.1", DEFAULT_PORT))
        .or_else(|_| Server::http(("127.0.0.1", 0)))
        .map_err(|e| format!("Could not start the local API: {e}"))?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(DEFAULT_PORT);
    let expected = format!("Bearer {token}");

    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            // Browsers send an Origin header; local scripts do not. Refusing it means
            // a web page cannot poke the API even if it somehow learned the token.
            let from_browser = request.headers().iter().any(|h| h.field.equiv("Origin"));
            let authorised = request
                .headers()
                .iter()
                .any(|h| h.field.equiv("Authorization") && h.value.as_str() == expected);
            if from_browser {
                let _ = request.respond(json(403, r#"{"ok":false,"error":"Browser requests are not accepted"}"#));
                continue;
            }
            if !authorised {
                let _ = request.respond(json(401, r#"{"ok":false,"error":"Missing or wrong token"}"#));
                continue;
            }

            let url = request.url().to_string();
            let (path, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
            let method = request.method().clone();

            if method == Method::Get && path == "/status" {
                let body = status.lock().map(|s| s.clone()).unwrap_or_default();
                let _ = request.respond(json(200, &body));
                continue;
            }
            let known = matches!(path, "/text" | "/notify" | "/frame" | "/image" | "/clear" | "/brightness");
            if method != Method::Post || !known {
                let _ = request.respond(json(404, r#"{"ok":false,"error":"Unknown endpoint"}"#));
                continue;
            }

            let mut bytes = Vec::new();
            if request.as_reader().take(MAX_BODY + 1).read_to_end(&mut bytes).is_err() {
                let _ = request.respond(json(400, r#"{"ok":false,"error":"Could not read the request body"}"#));
                continue;
            }
            if bytes.len() as u64 > MAX_BODY {
                let _ = request.respond(json(413, r#"{"ok":false,"error":"Body is larger than 8 MB"}"#));
                continue;
            }

            let (body, body_base64) = if path == "/image" {
                (String::new(), base64::engine::general_purpose::STANDARD.encode(&bytes))
            } else {
                let text = String::from_utf8(bytes).unwrap_or_default();
                let text = if text.trim().is_empty() { "{}".to_string() } else { text };
                if serde_json::from_str::<serde_json::Value>(&text).is_err() {
                    let _ = request.respond(json(400, r#"{"ok":false,"error":"Body is not valid JSON"}"#));
                    continue;
                }
                (text, String::new())
            };

            on_request(ApiRequest { path: path.to_string(), query: query.to_string(), body, body_base64 });
            let _ = request.respond(json(202, r#"{"ok":true}"#));
        }
    });
    Ok(port)
}
