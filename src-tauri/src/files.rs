//! File commands: read, atomic write, stat, command-line paths.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::AppState;

const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

#[derive(Serialize, Debug)]
pub struct FileData {
    /// Decoded text, without the BOM. Line endings are kept as they are.
    pub text: String,
    pub bom: bool,
    /// True if the file was not valid UTF-8: the invalid bytes were replaced
    /// with U+FFFD, so saving the text back would change the file.
    pub lossy: bool,
    /// Last write time, milliseconds since the Unix epoch.
    pub mtime: f64,
}

#[derive(Serialize, Debug)]
pub struct Mtime {
    pub mtime: f64,
}

pub fn mtime_of(path: &Path) -> Result<f64, String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    let t = m.modified().map_err(|e| e.to_string())?;
    Ok(t.duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as f64)
}

/// Turns command-line arguments (the first one is the program) into absolute
/// file paths, resolved against `cwd`. Flags are skipped.
pub fn files_from_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            let abs = if p.is_absolute() { p } else { cwd.join(p) };
            fs::canonicalize(&abs)
                .map(|c| c.to_string_lossy().trim_start_matches(r"\\?\").to_string())
                .unwrap_or_else(|_| abs.to_string_lossy().to_string())
        })
        .collect()
}

pub fn read(path: &Path) -> Result<FileData, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let bom = bytes.starts_with(&BOM);
    let body = if bom { &bytes[3..] } else { &bytes[..] };
    let (text, lossy) = match std::str::from_utf8(body) {
        Ok(t) => (t.to_owned(), false),
        Err(_) => (String::from_utf8_lossy(body).into_owned(), true),
    };
    Ok(FileData { text, bom, lossy, mtime: mtime_of(path)? })
}

/// Writes through a temp file in the same folder and renames it over the
/// target, so a crash never leaves a half-written file.
pub fn write_atomic(target: &Path, text: &str, bom: bool) -> Result<f64, String> {
    let name = target.file_name().ok_or("path has no file name")?.to_string_lossy().into_owned();
    let tmp = target.with_file_name(format!("{name}.mdtiger-tmp"));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        if bom {
            f.write_all(&BOM)?;
        }
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, target)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    mtime_of(target)
}

/// Native Open dialog (Markdown filter, multi-select). Empty if cancelled.
#[tauri::command]
pub async fn pick_files(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("All files", &["*"])
        .blocking_pick_files()
        .unwrap_or_default();
    picked.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect()
}

/// Native Save As dialog. None if cancelled.
#[tauri::command]
pub async fn pick_save_path(app: tauri::AppHandle, window: tauri::WebviewWindow, default_name: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_parent(&window)
        .set_file_name(default_name)
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn initial_files(state: State<AppState>) -> Vec<String> {
    state.initial.clone()
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileData, String> {
    read(Path::new(&path))
}

#[tauri::command]
pub fn write_file(path: String, text: String, bom: bool) -> Result<Mtime, String> {
    write_atomic(Path::new(&path), &text, bom).map(|mtime| Mtime { mtime })
}

#[tauri::command]
pub fn stat_file(path: String) -> Option<Mtime> {
    mtime_of(Path::new(&path)).ok().map(|mtime| Mtime { mtime })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_is_atomic_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.md");
        fs::write(&target, "old").unwrap();
        write_atomic(&target, "new\r\ntext", false).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new\r\ntext");
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1, "temp file left behind: {names:?}");
    }

    #[test]
    fn write_failure_keeps_the_original_and_removes_the_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        // The target is a non-empty folder: the rename must fail.
        let target = dir.path().join("a.md");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("child"), "x").unwrap();
        assert!(write_atomic(&target, "new", false).is_err());
        assert!(!dir.path().join("a.md.mdtiger-tmp").exists());
        assert!(target.join("child").exists());
    }

    #[test]
    fn bom_flag_is_written_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("b.md");
        write_atomic(&target, "héllo", true).unwrap();
        let raw = fs::read(&target).unwrap();
        assert_eq!(&raw[..3], &BOM);
        let data = read(&target).unwrap();
        assert!(data.bom);
        assert_eq!(data.text, "héllo");
    }

    #[test]
    fn read_without_bom() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("c.md");
        fs::write(&target, "plain\n").unwrap();
        let data = read(&target).unwrap();
        assert!(!data.bom);
        assert!(!data.lossy);
        assert_eq!(data.text, "plain\n");
    }

    #[test]
    fn invalid_utf8_is_read_lossily_and_flagged() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("l.md");
        fs::write(&target, [b'a', 0xE1, b'b']).unwrap(); // Latin-2 a-acute
        let data = read(&target).unwrap();
        assert!(data.lossy);
        assert_eq!(data.text, "a\u{FFFD}b");
    }

    #[test]
    fn read_missing_file_is_an_error_string() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read(&dir.path().join("nope.md")).is_err());
        assert!(stat_file(dir.path().join("nope.md").to_string_lossy().into_owned()).is_none());
    }

    #[test]
    fn args_are_resolved_against_the_working_directory() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("x.md"), "").unwrap();
        let args = vec!["mdtiger.exe".to_string(), "--flag".to_string(), "x.md".to_string()];
        let files = files_from_args(&args, dir.path());
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("x.md"));
        assert!(Path::new(&files[0]).is_absolute());
        assert!(!files[0].starts_with(r"\\?\"));
    }
}
