//! Plain HTTPS downloads for connectors whose servers a web page may not call
//! directly (a calendar's .ics link, stock quotes). Goes through the `curl`
//! that ships with Windows, macOS and most Linux systems.

use std::process::Command;

fn allowed(url: &str) -> bool {
    url.len() <= 2000 && url.starts_with("https://") && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Fetches `url` (https only, redirects stay on https, 2 MB and 15 s at most) and returns the body as text.
pub fn text(url: &str) -> Result<String, String> {
    if !allowed(url) {
        return Err("Only https:// links can be fetched".into());
    }
    let mut command = Command::new("curl");
    command.args([
        "--silent",
        "--show-error",
        "--fail",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-time",
        "15",
        "--max-filesize",
        "2000000",
        "--user-agent",
        "matrix-bridge",
        "--",
        url,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command.output().map_err(|_| "curl was not found on this computer".to_string())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let reason = stderr.lines().find(|line| !line.trim().is_empty()).unwrap_or("The download failed").trim();
    Err(reason.strip_prefix("curl: ").unwrap_or(reason).to_string())
}

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn https_only() {
        assert!(allowed("https://example.com/a.ics?x=1"));
        assert!(!allowed("http://example.com/a.ics"));
        assert!(!allowed("file:///etc/passwd"));
        assert!(!allowed("https://example.com/a b"));
        assert!(!allowed("-o out https://example.com"));
    }
}
