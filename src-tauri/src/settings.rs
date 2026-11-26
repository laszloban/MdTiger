//! `settings.json`: one human-readable file per user (FR-APP-02). The front
//! end owns the content; this module only stores it safely.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::{logging, profile};

const FILE_NAME: &str = "settings.json";

fn file_in(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Returns the stored settings, or `None` if the file is missing or can't be
/// parsed. An unparsable file is kept as `settings.json.bad`.
pub fn read_from(dir: &Path) -> Option<Value> {
    let path = file_in(dir);
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                logging::info("settings: no settings file yet, using defaults");
            } else {
                logging::warn(&format!("settings: cannot read {}: {e}", path.display()));
            }
            return None;
        }
    };
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&bytes);
    match serde_json::from_slice::<Value>(bytes) {
        Ok(v) if v.is_object() => Some(v),
        other => {
            let reason = match other {
                Err(e) => e.to_string(),
                _ => "not a JSON object".to_string(),
            };
            let bad = dir.join(format!("{FILE_NAME}.bad"));
            let _ = fs::remove_file(&bad);
            match fs::rename(&path, &bad) {
                Ok(()) => logging::warn(&format!("settings: unusable ({reason}); kept as {}", bad.display())),
                Err(e) => logging::warn(&format!("settings: unusable ({reason}); could not keep a copy: {e}")),
            }
            None
        }
    }
}

/// Writes pretty-printed JSON via a temp file and rename.
pub fn write_to(dir: &Path, value: &Value) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = file_in(dir);
    let tmp = dir.join(format!("{FILE_NAME}.tmp"));
    let mut text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    text.push('\n');
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, &path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn settings_read() -> Option<Value> {
    read_from(&profile::settings_dir())
}

#[tauri::command]
pub fn settings_write(json: Value) -> Result<(), String> {
    write_to(&profile::settings_dir(), &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_file_gives_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_from(dir.path()).is_none());
    }

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let v = json!({ "theme": "dark", "outline.width": 300, "unknown": { "x": [1, 2] } });
        write_to(dir.path(), &v).unwrap();
        assert_eq!(read_from(dir.path()), Some(v));
        assert!(!dir.path().join("settings.json.tmp").exists());
        // Human readable: more than one line.
        assert!(fs::read_to_string(dir.path().join("settings.json")).unwrap().lines().count() > 1);
    }

    #[test]
    fn broken_file_gives_none_and_is_kept_as_bad() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "{ not json").unwrap();
        assert!(read_from(dir.path()).is_none());
        assert!(!dir.path().join("settings.json").exists());
        assert_eq!(fs::read_to_string(dir.path().join("settings.json.bad")).unwrap(), "{ not json");
    }

    #[test]
    fn non_object_json_counts_as_broken() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "[1,2]").unwrap();
        assert!(read_from(dir.path()).is_none());
        assert!(dir.path().join("settings.json.bad").exists());
    }

    #[test]
    fn file_with_bom_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), b"\xEF\xBB\xBF{\"a\":1}").unwrap();
        assert_eq!(read_from(dir.path()), Some(json!({ "a": 1 })));
    }
}
