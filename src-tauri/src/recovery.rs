//! NFR-10: Tauri doesn't recover when the WebView2 renderer process dies (the
//! page just stays dead). Hook WebView2's ProcessFailed event directly and
//! reload; the front end then restores its state.

#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) {
    use crate::logging;
    let _ = window.with_webview(|wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use webview2_com::ProcessFailedEventHandler;
        let Ok(core) = wv.controller().CoreWebView2() else {
            logging::warn("crash recovery: no CoreWebView2");
            return;
        };
        let handler = ProcessFailedEventHandler::create(Box::new(
            |sender: Option<ICoreWebView2>, args: Option<ICoreWebView2ProcessFailedEventArgs>| -> windows_core::Result<()> {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                if let Some(a) = &args {
                    let _ = a.ProcessFailedKind(&mut kind);
                }
                logging::error(&format!("WebView2 process failed, kind {}", kind.0));
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                {
                    if let Some(s) = sender {
                        logging::info("recovery: reloading the page after a renderer failure");
                        let _ = s.Reload();
                    }
                }
                Ok(())
            },
        ));
        let mut token = 0i64;
        match core.add_ProcessFailed(&handler, &mut token) {
            Ok(()) => logging::info("crash recovery installed"),
            Err(e) => logging::warn(&format!("crash recovery: add_ProcessFailed failed: {e}")),
        }
    });
}

#[cfg(not(windows))]
pub fn install(_window: &tauri::WebviewWindow) {}
