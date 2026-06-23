use std::sync::Mutex as StdMutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tokio::sync::oneshot;

const PANEL_WIDTH: f64 = 360.0;
const PAN_WORKER_LABEL: &str = "pan-worker";
const PAN_SEARCH_URL: &str = "https://ird.gov.np/pan-search";
const PAN_WORKER_TITLE: &str = "NePad - PAN lookup (debug view)";
const EDGE_STRIP_LABEL: &str = "edge-strip";
const EDGE_STRIP_WIDTH: f64 = 4.0;
const EDGE_STRIP_HEIGHT: f64 = 110.0;
const REMINDER_TOAST_LABEL: &str = "reminder-toast";
const REMINDER_TOAST_WIDTH: f64 = 320.0;
const REMINDER_TOAST_HEIGHT: f64 = 150.0;
const REMINDER_TOAST_MARGIN: f64 = 16.0;
const TIMER_TOAST_LABEL: &str = "timer-toast";
const TIMER_TOAST_WIDTH: f64 = 150.0;
const TIMER_TOAST_HEIGHT: f64 = 64.0;
const TIMER_TOAST_MARGIN: f64 = 16.0;

fn toggle_main(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let visible = win.is_visible().unwrap_or(false);
    if visible {
        let _ = app.emit("nepad:slide-out", ());
    } else {
        show_panel(app);
    }
}

fn show_panel(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit("nepad:slide-in", ());
}

#[derive(Clone, serde::Serialize)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn default_main_rect(window: &tauri::WebviewWindow) -> Option<Rect> {
    let monitor = window.current_monitor().ok()??;
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = PANEL_WIDTH * scale;
    Some(Rect {
        x: work_area.position.x as f64 + work_area.size.width as f64 - width,
        y: work_area.position.y as f64,
        width,
        height: work_area.size.height as f64,
    })
}

#[tauri::command]
fn get_main_default_rect(app: tauri::AppHandle) -> Option<Rect> {
    app.get_webview_window("main")
        .and_then(|w| default_main_rect(&w))
}

fn spawn_edge_strip(app: &tauri::AppHandle) {
    if app.get_webview_window(EDGE_STRIP_LABEL).is_some() {
        return;
    }
    let Some(main_win) = app.get_webview_window("main") else {
        return;
    };
    let Some(monitor) = main_win.current_monitor().ok().flatten() else {
        return;
    };
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = EDGE_STRIP_WIDTH * scale;
    let height = EDGE_STRIP_HEIGHT * scale;
    let x = work_area.position.x as f64;
    let y = work_area.position.y as f64 + (work_area.size.height as f64 - height) / 2.0;

    let result = WebviewWindowBuilder::new(
        app,
        EDGE_STRIP_LABEL,
        WebviewUrl::App("index.html#edge-strip".into()),
    )
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .visible(false)
    .build();

    if let Ok(win) = &result {
        let _ = win.set_size(PhysicalSize::new(width, height));
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }

    if let Err(e) = result {
        eprintln!("[nepad] could not create the edge-strip window: {e}. Hotkey/tray still work.");
    }
}

fn spawn_reminder_toast(app: &tauri::AppHandle) {
    if app.get_webview_window(REMINDER_TOAST_LABEL).is_some() {
        return;
    }
    let Some(main_win) = app.get_webview_window("main") else {
        return;
    };
    let Some(monitor) = main_win.current_monitor().ok().flatten() else {
        return;
    };
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = REMINDER_TOAST_WIDTH * scale;
    let height = REMINDER_TOAST_HEIGHT * scale;
    let margin = REMINDER_TOAST_MARGIN * scale;
    let x = work_area.position.x as f64 + work_area.size.width as f64 - width - margin;
    let y = work_area.position.y as f64 + work_area.size.height as f64 - height - margin;

    let result = WebviewWindowBuilder::new(
        app,
        REMINDER_TOAST_LABEL,
        WebviewUrl::App("index.html#reminder-toast".into()),
    )
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(true)
    .visible(false)
    .build();

    if let Ok(win) = &result {
        let _ = win.set_size(PhysicalSize::new(width, height));
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }

    if let Err(e) = result {
        eprintln!("[nepad] could not create the reminder-toast window: {e}. Reminders still work, just without the popup.");
    }
}

#[tauri::command]
fn show_reminder_toast(app: tauri::AppHandle, text: String) -> Result<(), String> {
    spawn_reminder_toast(&app);
    let win = app
        .get_webview_window(REMINDER_TOAST_LABEL)
        .ok_or_else(|| "reminder-toast window is missing".to_string())?;
    app.emit_to(REMINDER_TOAST_LABEL, "nepad:reminder", text)
        .map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    Ok(())
}

fn spawn_timer_toast(app: &tauri::AppHandle) {
    if app.get_webview_window(TIMER_TOAST_LABEL).is_some() {
        return;
    }
    let Some(main_win) = app.get_webview_window("main") else {
        return;
    };
    let Some(monitor) = main_win.current_monitor().ok().flatten() else {
        return;
    };
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = TIMER_TOAST_WIDTH * scale;
    let height = TIMER_TOAST_HEIGHT * scale;
    let margin = TIMER_TOAST_MARGIN * scale;
    let x = work_area.position.x as f64 + margin;
    let y = work_area.position.y as f64 + work_area.size.height as f64 - height - margin;

    let result = WebviewWindowBuilder::new(
        app,
        TIMER_TOAST_LABEL,
        WebviewUrl::App("index.html#timer-toast".into()),
    )
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(true)
    .visible(false)
    .build();

    if let Ok(win) = &result {
        let _ = win.set_size(PhysicalSize::new(width, height));
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }

    if let Err(e) = result {
        eprintln!("[nepad] could not create the timer-toast window: {e}. The Tools-tab timer still works, just without the popup.");
    }
}

#[tauri::command]
fn show_timer_toast(app: tauri::AppHandle, text: String) -> Result<(), String> {
    spawn_timer_toast(&app);
    let win = app
        .get_webview_window(TIMER_TOAST_LABEL)
        .ok_or_else(|| "timer-toast window is missing".to_string())?;
    app.emit_to(TIMER_TOAST_LABEL, "nepad:timer-tick", text)
        .map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_window_visible(app: tauri::AppHandle, label: String, visible: bool) {
    if let Some(win) = app.get_webview_window(&label) {
        if visible {
            let _ = win.show();
        } else {
            let _ = win.hide();
        }
    }
}

#[tauri::command]
fn move_window(app: tauri::AppHandle, label: String, x: f64, y: f64) {
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
}

#[tauri::command]
fn get_main_position(app: tauri::AppHandle) -> Option<(f64, f64)> {
    let win = app.get_webview_window("main")?;
    let pos = win.outer_position().ok()?;
    Some((pos.x as f64, pos.y as f64))
}

#[tauri::command]
fn set_main_geometry(app: tauri::AppHandle, x: f64, y: f64, width: f64, height: f64) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_position(PhysicalPosition::new(x, y));
        let _ = win.set_size(PhysicalSize::new(width, height));
    }
}

#[tauri::command]
fn hide_main(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn show_main(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn was_autostart_launch() -> bool {
    std::env::args().any(|a| a == "--autostart")
}

#[tauri::command]
fn toggle_panel(app: tauri::AppHandle) {
    toggle_main(&app);
}

struct PanState {
    ready: StdMutex<bool>,
}

fn lock_ready(state: &StdMutex<bool>) -> std::sync::MutexGuard<'_, bool> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

async fn ensure_pan_window(app: &tauri::AppHandle, state: &PanState) -> Result<(), String> {
    if app.get_webview_window(PAN_WORKER_LABEL).is_none() {
        WebviewWindowBuilder::new(
            app,
            PAN_WORKER_LABEL,
            WebviewUrl::External(PAN_SEARCH_URL.parse().map_err(|e| format!("{e}"))?),
        )
        .title(PAN_WORKER_TITLE)
        .inner_size(900.0, 700.0)
        .visible(false)
        .initialization_script(PAN_API_INTERCEPT_SCRIPT)
        .build()
        .map_err(|e| e.to_string())?;
    }

    let already_ready = *lock_ready(&state.ready);
    if !already_ready {
        tokio::time::sleep(Duration::from_secs(6)).await;
        *lock_ready(&state.ready) = true;
    }
    Ok(())
}

#[tauri::command]
async fn eval_and_get(win: &tauri::WebviewWindow, script: &str) -> Result<String, String> {
    let (tx, rx) = oneshot::channel();
    let tx = StdMutex::new(Some(tx));
    win.eval_with_callback(script, move |result: String| {
        if let Some(tx) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = tx.send(result);
        }
    })
    .map_err(|e| e.to_string())?;

    match tokio::time::timeout(Duration::from_secs(3), rx).await {
        Ok(Ok(s)) => Ok(s),
        Ok(Err(_)) => Err("eval callback dropped".into()),
        Err(_) => Err("eval callback timed out".into()),
    }
}

const PAN_API_INTERCEPT_SCRIPT: &str = r#"(function () {
    window.__panApiData = null;
    const origFetch = window.fetch;
    window.fetch = function (...args) {
        return origFetch.apply(this, args).then((res) => {
            try {
                const url = (args[0] && args[0].url) || args[0];
                if (typeof url === 'string' && url.includes('getPanSearch')) {
                    res.clone().text().then((body) => { window.__panApiData = body; });
                }
            } catch (e) {}
            return res;
        });
    };
    const OrigXHR = window.XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    OrigXHR.prototype.open = function (method, url, ...rest) {
        this.__panUrl = url;
        return origOpen.call(this, method, url, ...rest);
    };
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            try {
                if (typeof this.__panUrl === 'string' && this.__panUrl.includes('getPanSearch')) {
                    window.__panApiData = this.responseText;
                }
            } catch (e) {}
        });
        return origSend.apply(this, args);
    };
})();"#;

const PAN_PROBE_SCRIPT: &str = r#"(function () {
    try {
        const hasPanDetail = Array.from(
            document.querySelectorAll('h1,h2,h3,h4,div,span,p')
        ).some((el) => el.textContent && el.textContent.trim() === 'PAN Detail');
        if (!hasPanDetail) return { status: 'pending' };

        const sectionLabels = ['Business Details', 'Registration Details'];
        const fields = {};
        const business = [];
        const registration = [];
        let currentSection = '';
        document.querySelectorAll('h1,h2,h3,h4,h5,div,span,p,table').forEach((el) => {
            if (el.tagName === 'TABLE') {
                const rows = Array.from(el.querySelectorAll('tr'));
                if (rows.length === 0) return;
                const firstCells = rows[0].children.length;
                if (firstCells === 2) {
                    rows.forEach((r) => {
                        const cells = r.children;
                        if (cells.length === 2) {
                            const key = cells[0].textContent.trim();
                            const val = cells[1].textContent.trim();
                            if (key) fields[key] = val;
                        }
                    });
                } else if (rows.length > 1) {
                    const header = Array.from(rows[0].children).map((c) => c.textContent.trim());
                    const target = currentSection === 'Registration Details' ? registration : business;
                    for (let i = 1; i < rows.length; i++) {
                        const cells = Array.from(rows[i].children).map((c) => c.textContent.trim());
                        const obj = {};
                        header.forEach((h, idx) => { obj[h] = cells[idx] ?? ''; });
                        target.push(obj);
                    }
                }
                return;
            }
            const text = el.textContent && el.textContent.trim();
            if (text && sectionLabels.includes(text)) currentSection = text;
        });

        try {
            if (window.__panApiData) {
                const apiJson = JSON.parse(window.__panApiData);
                const d = (apiJson && apiJson.data && apiJson.data.panDetails && apiJson.data.panDetails[0]) || null;
                if (d && fields.PAN && d.pan === fields.PAN) {
                    if (d.telephone) fields['Phone'] = d.telephone;
                    if (d.mobile) fields['Mobile'] = d.mobile;
                }
            }
        } catch (e) {}

        return { status: 'Found', fields, business, registration };
    } catch (e) {
        return { __debug_error: 'exception', message: String((e && e.message) || e) };
    }
})();"#;

#[tauri::command]
async fn pan_search_one(
    app: tauri::AppHandle,
    state: tauri::State<'_, PanState>,
    pan: String,
) -> Result<String, String> {
    if pan.len() != 9 || !pan.chars().all(|c| c.is_ascii_digit()) {
        return Err("PAN must be exactly 9 digits".into());
    }

    ensure_pan_window(&app, &state).await?;

    let win = app
        .get_webview_window(PAN_WORKER_LABEL)
        .ok_or_else(|| "PAN search window is missing".to_string())?;

    let fill_script = format!(
        r#"(function () {{
            try {{
                window.__panApiData = null;
                const inp = document.querySelector('#pan');
                const btn = document.querySelector('#submit');
                if (!inp || !btn) return {{ __debug_error: 'selector_missing', hasInput: !!inp, hasButton: !!btn, title: document.title }};
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(inp, '');
                inp.dispatchEvent(new Event('input', {{ bubbles: true }}));
                setter.call(inp, '{pan}');
                inp.dispatchEvent(new Event('input', {{ bubbles: true }}));
                inp.dispatchEvent(new Event('change', {{ bubbles: true }}));
                btn.click();
                return {{ status: 'submitted' }};
            }} catch (e) {{
                return {{ __debug_error: 'exception', message: String((e && e.message) || e) }};
            }}
        }})();"#
    );

    match eval_and_get(&win, &fill_script).await {
        Ok(json) => {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
                if value.get("__debug_error").is_some() {
                    return Ok(json);
                }
            }
        }
        Err(e) => return Err(format!("Could not run fill script: {e}")),
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        if let Ok(json) = eval_and_get(&win, PAN_PROBE_SCRIPT).await {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
                let status = value.get("status").and_then(|s| s.as_str()).unwrap_or("");
                if status == "Found" {
                    let found_pan = value
                        .get("fields")
                        .and_then(|f| f.get("PAN"))
                        .and_then(|p| p.as_str())
                        .unwrap_or("");
                    if found_pan == pan {
                        return Ok(json);
                    }
                } else if value.get("__debug_error").is_some() {
                    return Ok(json);
                }
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Timed out waiting for IRD response".into());
        }
        tokio::time::sleep(Duration::from_millis(600)).await;
    }
}

#[tauri::command]
fn read_pans_from_excel(path: String) -> Result<Vec<String>, String> {
    use calamine::{open_workbook_auto, Data, Reader};

    let mut workbook = open_workbook_auto(&path).map_err(|e| e.to_string())?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "Workbook has no sheets".to_string())?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| e.to_string())?;

    let mut pans = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in range.rows() {
        let Some(cell) = row.first() else { continue };
        let text = match cell {
            Data::String(s) => s.clone(),
            Data::Int(i) => i.to_string(),
            Data::Float(f) => format!("{f:.0}"),
            _ => continue,
        };
        let trimmed = text.trim();
        if trimmed.len() == 9 && trimmed.chars().all(|c| c.is_ascii_digit()) {
            if seen.insert(trimmed.to_string()) {
                pans.push(trimmed.to_string());
            }
        }
    }
    Ok(pans)
}

#[tauri::command]
fn write_excel(path: String, headers: Vec<String>, rows: Vec<Vec<String>>) -> Result<(), String> {
    use rust_xlsxwriter::{Format, Workbook};

    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    let bold = Format::new().set_bold();

    for (col, header) in headers.iter().enumerate() {
        sheet
            .write_string_with_format(0, col as u16, header, &bold)
            .map_err(|e| e.to_string())?;
    }
    for (r, row) in rows.iter().enumerate() {
        for (c, value) in row.iter().enumerate() {
            sheet
                .write_string((r + 1) as u32, c as u16, value)
                .map_err(|e| e.to_string())?;
        }
    }

    workbook.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Deserialize)]
struct ExcelSheet {
    name: String,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
}

#[tauri::command]
fn write_excel_multi(path: String, sheets: Vec<ExcelSheet>) -> Result<(), String> {
    use rust_xlsxwriter::{Format, Workbook};

    let mut workbook = Workbook::new();
    let bold = Format::new().set_bold();

    for sheet_data in &sheets {
        let sheet = workbook.add_worksheet();
        let safe_name: String = sheet_data.name.chars().take(31).collect();
        sheet.set_name(&safe_name).map_err(|e| e.to_string())?;

        for (col, header) in sheet_data.headers.iter().enumerate() {
            sheet
                .write_string_with_format(0, col as u16, header, &bold)
                .map_err(|e| e.to_string())?;
        }
        for (r, row) in sheet_data.rows.iter().enumerate() {
            for (c, value) in row.iter().enumerate() {
                if let Ok(n) = value.parse::<f64>() {
                    sheet
                        .write_number((r + 1) as u32, c as u16, n)
                        .map_err(|e| e.to_string())?;
                } else {
                    sheet
                        .write_string((r + 1) as u32, c as u16, value)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    workbook.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn find_uninstall_command(product_name: &str) -> Option<(String, std::path::PathBuf)> {
    use winreg::enums::*;
    use winreg::RegKey;

    let candidates = [
        (HKEY_CURRENT_USER, KEY_READ),
        (HKEY_CURRENT_USER, KEY_READ | KEY_WOW64_32KEY),
        (HKEY_LOCAL_MACHINE, KEY_READ),
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_32KEY),
    ];

    for (hive, flags) in candidates {
        let root = RegKey::predef(hive);
        let Ok(uninstall_key) =
            root.open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Uninstall", flags)
        else {
            continue;
        };

        for name in uninstall_key.enum_keys().flatten() {
            let Ok(sub) = uninstall_key.open_subkey_with_flags(&name, flags) else {
                continue;
            };
            let Ok(display_name) = sub.get_value::<String, _>("DisplayName") else {
                continue;
            };
            if display_name == product_name {
                if let Ok(uninstall_string) = sub.get_value::<String, _>("UninstallString") {
                    let install_location = sub
                        .get_value::<String, _>("InstallLocation")
                        .ok()
                        .map(|s| std::path::PathBuf::from(s.trim().trim_matches('"')))
                        .unwrap_or_default();
                    return Some((uninstall_string, install_location));
                }
            }
        }
    }
    None
}

#[cfg(windows)]
fn spawn_uninstall_command(raw: &str) -> std::io::Result<std::process::Child> {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            let exe = &rest[..end];
            let args: Vec<&str> = rest[end + 1..].split_whitespace().collect();
            return std::process::Command::new(exe).args(args).spawn();
        }
    }
    let mut parts = trimmed.split_whitespace();
    let exe = parts.next().unwrap_or(trimmed);
    let args: Vec<&str> = parts.collect();
    std::process::Command::new(exe).args(args).spawn()
}

#[cfg(windows)]
fn uninstall_exe_path(raw: &str) -> Option<std::path::PathBuf> {
    let trimmed = raw.trim();
    let exe = if let Some(rest) = trimmed.strip_prefix('"') {
        rest.find('"').map(|end| &rest[..end])
    } else {
        trimmed.split_whitespace().next()
    }?;
    Some(std::path::PathBuf::from(exe))
}

#[derive(serde::Serialize)]
struct EraseOutcome {
    data_cleared: bool,
    uninstaller_launched: bool,
}

#[tauri::command]
async fn erase_data_and_uninstall(app: tauri::AppHandle, confirm: String) -> Result<EraseOutcome, String> {
    if confirm != "DELETE" {
        return Err("Confirmation text did not match".into());
    }
    let data_cleared = match app.path().app_data_dir() {
        Ok(dir) if dir.exists() => std::fs::remove_dir_all(&dir).is_ok(),
        Ok(_) => true,
        Err(_) => false,
    };

    let mut uninstaller_launched = false;
    #[cfg(windows)]
    {
        if let Some((cmd, install_location)) = find_uninstall_command("NePad") {
            let trusted = match (uninstall_exe_path(&cmd), install_location.canonicalize().ok()) {
                (Some(exe), Some(install_dir)) => exe
                    .canonicalize()
                    .map(|exe| exe.starts_with(&install_dir))
                    .unwrap_or(false),
                _ => false,
            };
            if trusted && spawn_uninstall_command(&cmd).is_ok() {
                uninstaller_launched = true;
            }
        }
    }

    if uninstaller_launched {
        let handle = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            handle.exit(0);
        });
    }

    Ok(EraseOutcome {
        data_cleared,
        uninstaller_launched,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_panel(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .manage(PanState {
            ready: StdMutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_main_default_rect,
            get_main_position,
            set_main_geometry,
            hide_main,
            show_main,
            set_autostart,
            is_autostart_enabled,
            was_autostart_launch,
            toggle_panel,
            pan_search_one,
            read_pans_from_excel,
            write_excel,
            write_excel_multi,
            erase_data_and_uninstall,
            set_window_visible,
            move_window,
            show_reminder_toast,
            show_timer_toast,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show NePad", true, None::<&str>)?;
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

            let mut tray = TrayIconBuilder::new();
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            let _tray = tray
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_main(app),
                    "settings" => {
                        let _ = app.emit("nepad:open-settings", ());
                        if let Some(win) = app.get_webview_window("main") {
                            if !win.is_visible().unwrap_or(false) {
                                toggle_main(app);
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(tray.app_handle());
                    }
                })
                .build(app)?;

            let shortcut = Shortcut::new(Some(Modifiers::SUPER), Code::Backslash);
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!(
                    "[nepad] could not register global hotkey Win+\\: {e}. \
                     Another app likely already uses it. NePad still works via the tray icon."
                );
            }

            spawn_edge_strip(app.handle());
            spawn_reminder_toast(app.handle());
            spawn_timer_toast(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
