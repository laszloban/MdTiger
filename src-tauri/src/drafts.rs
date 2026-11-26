//! Draft store: unsaved text, one small file per draft under
//! `<profile>\drafts\`. The front end writes a draft shortly after every
//! change, so even a killed app loses (almost) nothing (NFR-10). Keys are
//! opaque strings; the file name is a hash of the key.

use std::fs;
use std::path::{Path, PathBuf};

use crate::profile;

/// FNV-1a, 64 bit: a stable, dependency-free name for a key.
fn key_name(key: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in key.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}.json")
}

fn path_in(dir: &Path, key: &str) -> PathBuf {
    dir.join(key_name(key))
}

fn write_in(dir: &Path, key: &str, value: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target = path_in(dir, key);
    let tmp = target.with_extension("tmp");
    fs::write(&tmp, value).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

fn read_in(dir: &Path, key: &str) -> Option<String> {
    fs::read_to_string(path_in(dir, key)).ok()
}

fn clear_in(dir: &Path, key: &str) {
    let _ = fs::remove_file(path_in(dir, key));
}

fn dir() -> PathBuf {
    profile::local_dir().join("drafts")
}

// Synchronous commands run in the order the front end sends them, so a clear
// can never overtake the write before it.
#[tauri::command]
pub fn draft_write(key: String, value: String) -> Result<(), String> {
    write_in(&dir(), &key, &value)
}

#[tauri::command]
pub fn draft_read(key: String) -> Option<String> {
    read_in(&dir(), &key)
}

#[tauri::command]
pub fn draft_clear(key: String) {
    clear_in(&dir(), &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_read_overwrite_clear() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_in(dir.path(), "k"), None);
        write_in(dir.path(), "k", "one").unwrap();
        assert_eq!(read_in(dir.path(), "k").as_deref(), Some("one"));
        write_in(dir.path(), "k", "two").unwrap();
        assert_eq!(read_in(dir.path(), "k").as_deref(), Some("two"));
        clear_in(dir.path(), "k");
        assert_eq!(read_in(dir.path(), "k"), None);
        clear_in(dir.path(), "k"); // clearing a missing draft is fine
    }

    #[test]
    fn keys_do_not_collide_and_leave_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        write_in(dir.path(), "file:c:\\a.md", "a").unwrap();
        write_in(dir.path(), "file:c:\\b.md", "b").unwrap();
        assert_eq!(read_in(dir.path(), "file:c:\\a.md").as_deref(), Some("a"));
        assert_eq!(read_in(dir.path(), "file:c:\\b.md").as_deref(), Some("b"));
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 2, "{names:?}");
    }
}
