// MdTiger spike: thin Tauri 2 shell around the shared TypeScript front end.
// Everything here implements the front end's Host interface (src/host/host.ts).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, UNIX_EPOCH};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    started: Instant,
    initial: Vec<String>,
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

#[derive(Serialize)]
struct FileData {
    text: String,
    bom: bool,
    mtime: f64,
}

#[derive(Serialize)]
struct Mtime {
    mtime: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DefaultAppStatus {
    is_default: bool,
    current_prog_id: Option<String>,
}

fn mtime_of(path: &Path) -> Result<f64, String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    let t = m.modified().map_err(|e| e.to_string())?;
    Ok(t.duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as f64)
}

fn log_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    let dir = PathBuf::from(base).join("MdTiger");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// NFR-11: errors go to a log file, never to a dialog.
fn write_log(level: &str, message: &str) {
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log_dir().join("spike-tauri.log")) {
        let now = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let _ = writeln!(f, "{now} [{level}] {message}");
    }
}

/// Turns command-line arguments into absolute file paths.
fn files_from_args(args: &[String], cwd: &Path) -> Vec<String> {
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

#[tauri::command]
fn initial_files(state: State<AppState>) -> Vec<String> {
    state.initial.clone()
}

#[tauri::command]
fn read_file(path: String) -> Result<FileData, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let text = String::from_utf8_lossy(if bom { &bytes[3..] } else { &bytes[..] }).into_owned();
    Ok(FileData { text, bom, mtime: mtime_of(Path::new(&path))? })
}

/// Writes via a temp file + rename, so a crash never leaves a half-written file.
#[tauri::command]
fn write_file(path: String, text: String, bom: bool) -> Result<Mtime, String> {
    let target = PathBuf::from(&path);
    let tmp = target.with_extension("mdtiger-tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        if bom {
            f.write_all(&[0xEF, 0xBB, 0xBF]).map_err(|e| e.to_string())?;
        }
        f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    Ok(Mtime { mtime: mtime_of(&target)? })
}

#[tauri::command]
fn stat_file(path: String) -> Option<Mtime> {
    mtime_of(Path::new(&path)).ok().map(|mtime| Mtime { mtime })
}

/// Watches the file's folder (not the file itself) so that editors which save
/// by writing a temp file and renaming it are still noticed.
#[tauri::command]
fn watch_file(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    let key = path.to_lowercase();
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    if watchers.contains_key(&key) {
        return Ok(());
    }
    let target = PathBuf::from(&path);
    let dir = target.parent().ok_or("no parent folder")?.to_path_buf();
    let name = target.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let reported = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| match res {
        Ok(ev) => {
            let hit = ev.paths.iter().any(|p| {
                p.file_name().map(|n| n.to_string_lossy().to_lowercase() == name).unwrap_or(false)
            });
            if hit {
                let _ = app.emit("host-event", json!({ "type": "changed", "path": reported }));
            }
        }
        Err(e) => write_log("warn", &format!("watch error: {e}")),
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    watchers.insert(key, watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_file(state: State<AppState>, path: String) {
    if let Ok(mut w) = state.watchers.lock() {
        w.remove(&path.to_lowercase());
    }
}

#[tauri::command]
fn default_app_status() -> DefaultAppStatus {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let prog: Option<String> = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice")
            .and_then(|k| k.get_value("ProgId"))
            .ok();
        let is_default = prog.as_deref().map(|p| p.to_lowercase().contains("mdtiger")).unwrap_or(false);
        return DefaultAppStatus { is_default, current_prog_id: prog };
    }
    #[allow(unreachable_code)]
    DefaultAppStatus { is_default: true, current_prog_id: None }
}

/// Windows doesn't let apps make themselves the default silently; open the
/// system's Default apps page instead (FR-APP-05).
#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg("ms-settings:defaultapps")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// S1: the front end calls this once the first document is painted.
#[tauri::command]
fn spike_ready(app: AppHandle, state: State<AppState>, ms_since_navigation: f64) {
    let process_ms = state.started.elapsed().as_secs_f64() * 1000.0;
    let line = format!("ready: {process_ms:.0} ms since main(), {ms_since_navigation:.0} ms since navigation");
    write_log("info", &line);
    if let Ok(result_file) = std::env::var("MDTIGER_SPIKE_RESULT") {
        let _ = fs::write(result_file, format!("{process_ms:.0};{ms_since_navigation:.0}"));
    }
    if std::env::var("MDTIGER_SPIKE_EXIT_ON_READY").is_ok() {
        app.exit(0);
    }
}

#[tauri::command]
fn log_msg(level: String, message: String) {
    write_log(&level, &message);
}

/// NFR-10 / S9: Tauri doesn't recover when the WebView2 renderer process dies
/// (the page just stays dead). Hook WebView2's ProcessFailed event directly
/// and reload; the front end then restores unsaved edits from its drafts.
#[cfg(windows)]
fn install_crash_recovery(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use webview2_com::ProcessFailedEventHandler;
        let Ok(core) = wv.controller().CoreWebView2() else {
            write_log("warn", "crash recovery: no CoreWebView2");
            return;
        };
        let handler = ProcessFailedEventHandler::create(Box::new(
            |sender: Option<ICoreWebView2>, args: Option<ICoreWebView2ProcessFailedEventArgs>| -> windows_core::Result<()> {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                if let Some(a) = &args {
                    let _ = a.ProcessFailedKind(&mut kind);
                }
                write_log("error", &format!("WebView2 process failed, kind {}", kind.0));
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                {
                    if let Some(s) = sender {
                        let _ = s.Reload();
                    }
                }
                Ok(())
            },
        ));
        let mut token = 0i64;
        if let Err(e) = core.add_ProcessFailed(&handler, &mut token) {
            write_log("warn", &format!("crash recovery: add_ProcessFailed failed: {e}"));
        }
    });
}

fn main() {
    let started = Instant::now();
    let cwd = std::env::current_dir().unwrap_or_default();
    let args: Vec<String> = std::env::args().collect();
    let initial = files_from_args(&args, &cwd);

    // NFR-11: a panic is logged, not shown.
    std::panic::set_hook(Box::new(|info| write_log("error", &format!("panic: {info}"))));

    tauri::Builder::default()
        // Must be first: a second launch hands its files to this instance (FR-FILE-10).
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            for path in files_from_args(&argv, Path::new(&cwd)) {
                let _ = app.emit("host-event", json!({ "type": "open", "path": path }));
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { started, initial, watchers: Mutex::new(HashMap::new()) })
        .setup(|app| {
            #[cfg(windows)]
            if let Some(w) = app.get_webview_window("main") {
                install_crash_recovery(&w);
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_files,
            read_file,
            write_file,
            stat_file,
            watch_file,
            unwatch_file,
            default_app_status,
            open_default_apps_settings,
            spike_ready,
            log_msg
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| write_log("error", &format!("tauri run failed: {e}")));
}
