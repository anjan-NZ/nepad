pub mod tds;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const IRD_LABEL: &str = "ird-portal";
const IRD_URL: &str = "https://taxpayerportal.ird.gov.np/taxpayer/app.html";
const CAPTURE_JS: &str = include_str!("capture.js");
static POPUP_SEQ: AtomicU32 = AtomicU32::new(0);
pub static AUTO_HIDDEN: AtomicBool = AtomicBool::new(false);
pub static HIDE_POPUPS: AtomicBool = AtomicBool::new(false);

pub fn close_popups(app: &tauri::AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with("ird-popup-") {
            let _ = w.close();
        }
    }
}

pub fn downloads_dir(app: &tauri::AppHandle) -> PathBuf {
    let base = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = base.join("IRD Downloads");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub fn ird_downloads_dir(app: tauri::AppHandle) -> String {
    downloads_dir(&app).to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn ird_open_portal(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(IRD_LABEL) {
        AUTO_HIDDEN.store(true, Ordering::Relaxed);
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    AUTO_HIDDEN.store(false, Ordering::Relaxed);

    let dir = downloads_dir(&app);
    let url = IRD_URL.parse().map_err(|e| format!("{e}"))?;
    let app_for_popup = app.clone();
    let dir_for_popup = dir.clone();
    let builder = WebviewWindowBuilder::new(&app, IRD_LABEL, WebviewUrl::External(url))
        .title("IRD Portal - NePad")
        .inner_size(1200.0, 800.0)
        .center()
        .resizable(true)
        .on_download(move |_wv, event| {
            redirect_download(&dir, event);
            true
        })
        .on_new_window(move |url, features| {
            let n = POPUP_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = dir_for_popup.clone();
            let mut b = WebviewWindowBuilder::new(
                &app_for_popup,
                format!("ird-popup-{n}"),
                WebviewUrl::External(url.clone()),
            )
            .window_features(features)
            .title(url.as_str())
            .initialization_script(CAPTURE_JS)
            .on_document_title_changed(|w, t| {
                let _ = w.set_title(&t);
            })
            .on_download(move |_wv, event| {
                redirect_download(&dir, event);
                true
            });
            if HIDE_POPUPS.load(Ordering::Relaxed) {
                b = b.visible(false);
            }
            match b.build() {
                Ok(window) => NewWindowResponse::Create { window },
                Err(_) => NewWindowResponse::Deny,
            }
        });

    let win = builder.build().map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
    let _ = win.set_always_on_top(false);
    Ok(())
}

fn redirect_download(dir: &std::path::Path, event: DownloadEvent<'_>) {
    if let DownloadEvent::Requested { destination, .. } = event {
        if let Some(name) = destination.file_name() {
            *destination = dir.join(name);
        }
    }
}
