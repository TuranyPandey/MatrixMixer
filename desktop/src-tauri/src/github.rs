//! Read-only GitHub lookups for the GitHub connector.
//!
//! These go through the GitHub CLI (`gh api`), so the app never sees or stores a
//! token and private repositories work with whatever `gh auth login` set up.
//! The window may only ask for the two endpoints the connector needs.

use std::process::Command;

fn is_name(part: &str) -> bool {
    !part.is_empty()
        && part.len() <= 100
        && part != "."
        && part != ".."
        && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `repos/{owner}/{repo}/activity?per_page=N` or `repos/{owner}/{repo}/actions/runs?per_page=N`.
fn allowed(path: &str) -> bool {
    let Some((route, query)) = path.split_once('?') else {
        return false;
    };
    let query_ok = query
        .strip_prefix("per_page=")
        .is_some_and(|n| !n.is_empty() && n.len() <= 3 && n.chars().all(|c| c.is_ascii_digit()));
    let parts: Vec<&str> = route.split('/').collect();
    let route_ok = match parts.as_slice() {
        ["repos", owner, repo, "activity"] | ["repos", owner, repo, "actions", "runs"] => is_name(owner) && is_name(repo),
        _ => false,
    };
    query_ok && route_ok
}

/// Returns the response body as JSON text.
pub fn get(path: &str) -> Result<String, String> {
    if !allowed(path) {
        return Err("That GitHub request is not allowed".into());
    }
    let mut command = Command::new("gh");
    command.args(["api", "-H", "Accept: application/vnd.github+json", path]);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console flashing up every minute.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|_| "GitHub CLI (gh) was not found. Install it, then run: gh auth login".to_string())?;
    if output.status.success() {
        return String::from_utf8(output.stdout).map_err(|_| "GitHub sent something unreadable".to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let reason = stderr.lines().find(|line| !line.trim().is_empty()).unwrap_or("gh api failed").trim();
    Err(reason.strip_prefix("gh: ").unwrap_or(reason).to_string())
}

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn only_the_two_read_endpoints() {
        assert!(allowed("repos/octocat/hello-world/activity?per_page=20"));
        assert!(allowed("repos/octocat/hello.world/actions/runs?per_page=20"));
        assert!(!allowed("repos/octocat/hello-world/activity"));
        assert!(!allowed("repos/octocat/hello-world/issues?per_page=20"));
        assert!(!allowed("repos/octocat/../activity?per_page=20"));
        assert!(!allowed("user?per_page=1"));
        assert!(!allowed("repos/octocat/hello-world/activity?per_page=20&x=1"));
        assert!(!allowed("-X DELETE repos/a/b/activity?per_page=1"));
    }
}
