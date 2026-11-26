//! Where MdTiger keeps its data.
//!
//! Normally settings live in `%APPDATA%\MdTiger\` and logs plus WebView data in
//! `%LOCALAPPDATA%\MdTiger\`. If `MDTIGER_PROFILE_DIR` is set, everything goes
//! under that single folder instead (the end-to-end tests rely on this to stay
//! away from the user's real profile).

use std::env;
use std::path::PathBuf;

pub const PROFILE_ENV: &str = "MDTIGER_PROFILE_DIR";

fn override_dir() -> Option<PathBuf> {
    env::var_os(PROFILE_ENV).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn base(var: &str, fallback: &str) -> PathBuf {
    if let Some(v) = env::var_os(var).filter(|v| !v.is_empty()) {
        return PathBuf::from(v);
    }
    // Non-Windows fallback (development only).
    if let Some(home) = env::var_os("HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(home).join(fallback);
    }
    env::temp_dir()
}

/// Folder holding `settings.json`.
pub fn settings_dir() -> PathBuf {
    override_dir().unwrap_or_else(|| base("APPDATA", ".config").join("MdTiger"))
}

/// Folder holding the logs (`logs\`) and the WebView2 user data (`webview\`).
pub fn local_dir() -> PathBuf {
    override_dir().unwrap_or_else(|| base("LOCALAPPDATA", ".local/share").join("MdTiger"))
}

pub fn log_dir() -> PathBuf {
    local_dir().join("logs")
}

pub fn webview_dir() -> PathBuf {
    local_dir().join("webview")
}
