// MdTiger: thin Tauri 2 shell around the TypeScript front end.
// Everything here implements the front end's Host interface (src/host/host.ts).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod drafts;
mod files;
mod logging;
mod profile;
mod recovery;
mod settings;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// If the front end never reports "ready", the window is shown anyway after this.
const SHOW_FALLBACK: Duration = Duration::from_secs(2);

pub struct AppState {
    started: Instant,
    /// Paths from the command line, resolved. Same list on every call.
    pub initial: Vec<String>,
    shown: AtomicBool,
    /// A window close is waiting for the front end (it may be showing a dialog).
    close_pending: AtomicBool,
    /// The front end has acknowledged the close request (it is alive).
    close_acked: AtomicBool,
}

/// If the front end doesn't acknowledge a close request within this time, the
/// page is considered dead and the window closes anyway (drafts keep the text).
const CLOSE_ACK_TIMEOUT: Duration = Duration::from_secs(3);

/// Shows the main window once (idempotent).
fn show_main(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.shown.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The front end calls this once the first frame is painted: logs the timings
/// and shows the window (it is created hidden to avoid a white flash).
#[tauri::command]
fn app_ready(app: AppHandle, state: State<AppState>, ms_since_navigation: f64) {
    let process_ms = state.started.elapsed().as_secs_f64() * 1000.0;
    logging::info(&format!("ready ProcessMs={process_ms:.0} FrontMs={ms_since_navigation:.0}"));
    show_main(&app);
}

#[tauri::command]
fn log_msg(level: String, message: String) {
    logging::log(&level, &message);
}

#[tauri::command]
fn set_title(window: tauri::WebviewWindow, title: String) {
    let _ = window.set_title(&title);
}

#[tauri::command]
fn is_test_mode() -> bool {
    std::env::var("MDTIGER_TEST").map(|v| v == "1").unwrap_or(false)
}

/// The front end is alive and handling the close request (sent once a second).
#[tauri::command]
fn close_ack(state: State<AppState>) {
    state.close_acked.store(true, Ordering::SeqCst);
}

/// The front end's answer: close the window, or keep it open.
#[tauri::command]
fn close_response(window: tauri::WebviewWindow, state: State<AppState>, allow: bool) {
    state.close_pending.store(false, Ordering::SeqCst);
    if allow {
        logging::info("window close confirmed by the front end");
        let _ = window.destroy();
    } else {
        logging::info("window close cancelled by the user");
    }
}

fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    use tauri::{DragDropEvent, WindowEvent};
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            let app = window.app_handle();
            let state = app.state::<AppState>();
            // Before the front end is up there is nothing to ask.
            if !state.shown.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            if state.close_pending.swap(true, Ordering::SeqCst) {
                logging::info("close requested again while the front end is still deciding");
                return; // already asking
            }
            logging::info("close requested, asking the front end");
            state.close_acked.store(false, Ordering::SeqCst);
            let _ = app.emit("close-requested", ());
            let window = window.clone();
            // The page may show a dialog for as long as the user needs, but it
            // must keep saying it is alive (close_ack, once a second). Three
            // silent seconds mean a dead or frozen page: close anyway.
            std::thread::spawn(move || loop {
                std::thread::sleep(CLOSE_ACK_TIMEOUT);
                let state = window.app_handle().state::<AppState>();
                if !state.close_pending.load(Ordering::SeqCst) {
                    return;
                }
                if !state.close_acked.swap(false, Ordering::SeqCst) {
                    logging::warn("front end did not answer the close request in 3 s, closing anyway");
                    let _ = window.destroy();
                    return;
                }
            });
        }
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            for p in paths {
                let path = p.to_string_lossy().into_owned();
                logging::info(&format!("drop event: {path}"));
                let _ = window.app_handle().emit("host-event", json!({ "type": "drop", "path": path }));
            }
        }
        _ => {}
    }
}

/// Only registered when MDTIGER_TEST=1: lets the tests check the panic hook.
#[tauri::command]
fn test_panic() {
    std::thread::spawn(|| panic!("e2e-test-panic"));
}

fn main() {
    let started = Instant::now();
    logging::init(profile::log_dir());

    // NFR-11: a panic is logged, never shown.
    std::panic::set_hook(Box::new(|info| logging::error(&format!("panic: {info}"))));

    let cwd = std::env::current_dir().unwrap_or_default();
    let args: Vec<String> = std::env::args().collect();
    let initial = files::files_from_args(&args, &cwd);
    logging::info(&format!("start version={} files={}", env!("CARGO_PKG_VERSION"), initial.len()));

    let builder = tauri::Builder::default()
        // Must be first: a second launch hands its files to this instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = files::files_from_args(&argv, Path::new(&cwd));
            logging::info(&format!("second instance forwarded {} path(s)", paths.len()));
            for path in paths {
                logging::info(&format!("open event: {path}"));
                let _ = app.emit("host-event", json!({ "type": "open", "path": path }));
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(on_window_event)
        .manage(AppState { started, initial, shown: AtomicBool::new(false), close_pending: AtomicBool::new(false), close_acked: AtomicBool::new(false) })
        .setup(|app| {
            // Created in code (not in tauri.conf.json) so the WebView data
            // folder can be set. Hidden until the front end reports "ready".
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("MdTiger")
                .inner_size(1280.0, 860.0)
                .min_inner_size(640.0, 400.0)
                .visible(false);
            #[cfg(windows)]
            {
                window = window.data_directory(profile::webview_dir());
            }
            if let Some(icon) = app.default_window_icon() {
                window = window.icon(icon.clone())?;
            }
            let window = window.build()?;
            recovery::install(&window);

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                if !handle.state::<AppState>().shown.load(Ordering::SeqCst) {
                    logging::warn("front end not ready after 2 s, showing the window anyway");
                    show_main(&handle);
                }
            });
            Ok(())
        });

    let test_mode = std::env::var("MDTIGER_TEST").map(|v| v == "1").unwrap_or(false);
    let builder = if test_mode {
        logging::info("test mode: test_panic command registered");
        builder.invoke_handler(tauri::generate_handler![
            files::initial_files,
            files::read_file,
            files::write_file,
            files::stat_file,
            drafts::draft_write,
            drafts::draft_read,
            drafts::draft_clear,
            files::pick_files,
            files::pick_save_path,
            set_title,
            is_test_mode,
            close_ack,
            close_response,
            settings::settings_read,
            settings::settings_write,
            log_msg,
            app_ready,
            test_panic
        ])
    } else {
        builder.invoke_handler(tauri::generate_handler![
            files::initial_files,
            files::read_file,
            files::write_file,
            files::stat_file,
            drafts::draft_write,
            drafts::draft_read,
            drafts::draft_clear,
            files::pick_files,
            files::pick_save_path,
            set_title,
            is_test_mode,
            close_ack,
            close_response,
            settings::settings_read,
            settings::settings_write,
            log_msg,
            app_ready
        ])
    };

    builder
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| logging::error(&format!("tauri run failed: {e}")));
}
