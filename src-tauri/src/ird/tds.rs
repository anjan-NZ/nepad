use super::{downloads_dir, IRD_LABEL};
use reqwest::cookie::Jar;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Emitter, Manager, Url};

const ORIGIN: &str = "https://taxpayerportal.ird.gov.np";
const REFERER: &str = "https://taxpayerportal.ird.gov.np/taxpayer/app.html";
const GAP_MS: u64 = 1000;
const MAX_CONSECUTIVE_FAILS: usize = 3;

#[derive(Serialize)]
pub struct TdsRow {
    #[serde(rename = "tranNo")]
    tran_no: String,
    status: String,
    #[serde(rename = "statusText")]
    status_text: String,
}

#[derive(Deserialize)]
pub struct TdsPick {
    #[serde(rename = "tranNo")]
    tran_no: String,
    status: String,
}

#[derive(Serialize)]
pub struct DlResult {
    #[serde(rename = "tranNo")]
    tran_no: String,
    ok: bool,
    detail: String,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: usize,
    total: usize,
}

struct Session {
    jar_client: reqwest::Client,
    cookie_header: String,
    ua: String,
}

fn session_client(app: &tauri::AppHandle, ua: &str) -> Result<Session, String> {
    if ua.is_empty() || ua.len() > 300 || !ua.is_ascii() {
        return Err("Bad browser identity string".into());
    }
    let win = app
        .get_webview_window(IRD_LABEL)
        .ok_or("Open the IRD portal and log in first")?;
    let url: Url = ORIGIN.parse().map_err(|e| format!("{e}"))?;
    let cookies = win.cookies_for_url(url.clone()).map_err(|e| e.to_string())?;
    if !cookies.iter().any(|c| c.name() == "ASP.NET_SessionId") {
        return Err("No portal session found. Log in inside the portal window first".into());
    }
    let jar = Arc::new(Jar::default());
    for c in &cookies {
        jar.add_cookie_str(&format!("{}={}", c.name(), c.value()), &url);
    }
    let cookie_header = cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    let base = || {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert(reqwest::header::ACCEPT, reqwest::header::HeaderValue::from_static("*/*"));
        reqwest::Client::builder()
            .user_agent(ua)
            .default_headers(h)
            .http1_title_case_headers()
            .redirect(reqwest::redirect::Policy::none())
    };
    Ok(Session {
        jar_client: base().cookie_provider(jar).build().map_err(|e| e.to_string())?,
        cookie_header,
        ua: ua.to_string(),
    })
}

fn after<'a>(hay: &'a str, key: &str) -> Option<&'a str> {
    hay.find(key).map(|i| &hay[i + key.len()..])
}

fn parse_rows(txt: &str) -> Vec<TdsRow> {
    let mut rows = Vec::new();
    for chunk in txt.split('{').skip(1) {
        let obj = chunk.split('}').next().unwrap_or("");
        let Some(rest) = after(obj, "\"TranNo\":") else { continue };
        let tran_no: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if tran_no.is_empty() {
            continue;
        }
        let quoted = |key: &str| {
            after(obj, key)
                .and_then(|r| r.split('"').next())
                .unwrap_or("")
                .to_string()
        };
        rows.push(TdsRow {
            tran_no,
            status: quoted("\"StatusID\":\""),
            status_text: quoted("\"Status\":\""),
        });
    }
    rows
}

fn safe(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

#[tauri::command]
pub async fn ird_session_ready(app: tauri::AppHandle, ua: String) -> bool {
    let Ok(session) = session_client(&app, &ua) else { return false };
    let Ok(txt) = list_raw(&session.jar_client, "0", "2081.04.01", "2081.04.02").await else {
        return false;
    };
    let ready = txt.contains("root:[");
    if ready && !super::AUTO_HIDDEN.swap(true, std::sync::atomic::Ordering::Relaxed) {
        if let Some(w) = app.get_webview_window(IRD_LABEL) {
            let _ = w.hide();
        }
        if let Some(m) = app.get_webview_window("main") {
            let _ = m.show();
            let _ = m.set_focus();
        }
    }
    ready
}

fn portal_rejected(txt: &str) -> bool {
    txt.contains("Oopspage") || txt.contains("Could not process")
}

async fn list_raw(client: &reqwest::Client, pan: &str, from: &str, to: &str) -> Result<String, String> {
    let obj = format!(r#"{{"WhPan":"{pan}","FromDate":"{from}","ToDate":"{to}"}}"#);
    let res = client
        .get(format!("{ORIGIN}/Handlers/TDS/GetTransactionHandler.ashx"))
        .query(&[
            ("method", "GetWithholderRecs"),
            ("objWith", obj.as_str()),
            ("page", "1"),
            ("start", "0"),
            ("limit", "1000"),
        ])
        .header("Referer", REFERER)
        .header("Accept", "application/json, text/javascript, */*; q=0.01")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ird_list_tds(
    app: tauri::AppHandle,
    pan: String,
    from: String,
    to: String,
    ua: String,
) -> Result<Vec<TdsRow>, String> {
    if !safe(&pan) || !safe(&from) || !safe(&to) {
        return Err("PAN and dates must be digits/dots only".into());
    }
    let client = session_client(&app, &ua)?.jar_client;
    let txt = list_raw(&client, &pan, &from, &to).await?;
    if portal_rejected(&txt) {
        return Err("Portal did not accept the list request (session expired? log in again)".into());
    }
    Ok(parse_rows(&txt))
}

async fn form_token(client: &reqwest::Client) -> String {
    let Ok(res) = client
        .get(format!("{ORIGIN}/Handlers/AuthenticationHandler.ashx"))
        .query(&[("method", "GetToken")])
        .header("Referer", REFERER)
        .send()
        .await
    else {
        return "a".into();
    };
    let txt = res.text().await.unwrap_or_default();
    after(&txt, "root:\"")
        .and_then(|r| r.split('"').next())
        .filter(|t| !t.is_empty())
        .unwrap_or("a")
        .to_string()
}

#[tauri::command]
pub async fn ird_download_tds(
    app: tauri::AppHandle,
    pan: String,
    items: Vec<TdsPick>,
    ua: String,
) -> Result<Vec<DlResult>, String> {
    if !safe(&pan) {
        return Err("Bad PAN".into());
    }
    let session = session_client(&app, &ua)?;
    let token = form_token(&session.jar_client).await;
    let dir = downloads_dir(&app);
    let total = items.len();
    let mut results = Vec::with_capacity(total);
    let mut fails_in_a_row = 0;

    for (i, it) in items.iter().enumerate() {
        let _ = app.emit("ird-progress", Progress { done: i, total });
        match download_one(&app, &session, &token, &dir, &pan, it).await {
            Ok(name) => {
                fails_in_a_row = 0;
                results.push(DlResult { tran_no: it.tran_no.clone(), ok: true, detail: name });
            }
            Err(e) => {
                fails_in_a_row += 1;
                results.push(DlResult { tran_no: it.tran_no.clone(), ok: false, detail: e });
                if fails_in_a_row >= MAX_CONSECUTIVE_FAILS {
                    for rest in &items[i + 1..] {
                        results.push(DlResult {
                            tran_no: rest.tran_no.clone(),
                            ok: false,
                            detail: "skipped: stopped after repeated failures".into(),
                        });
                    }
                    break;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(GAP_MS)).await;
    }
    let _ = app.emit("ird-progress", Progress { done: total, total });
    Ok(results)
}

async fn run_curl(ua: &str, cookies: &str, token: &str, it: &TdsPick, out: &std::path::Path) -> Result<(), String> {
    let curl = std::path::Path::new(r"C:\Windows\System32\curl.exe");
    if !curl.exists() {
        return Err("curl.exe not found".into());
    }
    let status = tokio::process::Command::new(curl)
        .arg("-s")
        .arg("-L")
        .arg("--max-redirs").arg("5")
        .arg("--max-time").arg("60")
        .arg("-o").arg(out)
        .arg("-A").arg(ua)
        .arg("-H").arg(format!("Cookie: {cookies}"))
        .arg("-H").arg(format!("Referer: {REFERER}"))
        .arg("-H").arg(format!("Origin: {ORIGIN}"))
        .arg("--data-urlencode").arg(format!("TranNo={}", it.tran_no))
        .arg("--data-urlencode").arg(format!("Status={}", it.status))
        .arg("--data-urlencode").arg(format!("formToken={token}"))
        .arg(format!("{ORIGIN}/Reporting/TDS/ReportHandlers/TDSSubmissionReportHandler.ashx"))
        .creation_flags(0x0800_0000)
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("curl exited with {status}"));
    }
    Ok(())
}

async fn run_flow(
    client: &reqwest::Client,
    static_cookies: Option<&str>,
    token: &str,
    it: &TdsPick,
) -> (Vec<u8>, String) {
    let mut trail: Vec<String> = Vec::new();
    let mut req = client
        .post(format!("{ORIGIN}/Reporting/TDS/ReportHandlers/TDSSubmissionReportHandler.ashx"))
        .header("Referer", REFERER)
        .header("Origin", ORIGIN)
        .form(&[
            ("TranNo", it.tran_no.as_str()),
            ("Status", it.status.as_str()),
            ("formToken", token),
        ]);
    if let Some(c) = static_cookies {
        req = req.header("Cookie", c);
    }
    for _ in 0..5 {
        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                trail.push(format!("send error: {e}"));
                break;
            }
        };
        let status = res.status();
        let path = res.url().path().to_string();
        let bigip: Vec<String> = res
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter(|c| c.starts_with("BIGip"))
            .map(|c| c.split(';').next().unwrap_or("").split('=').nth(1).unwrap_or("").to_string())
            .collect();
        let loc = res
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        trail.push(format!(
            "{:?} {} {}{} node:{}",
            res.version(),
            status.as_u16(),
            path,
            loc.as_ref().map(|l| format!(" -> {}", l.rsplit('/').next().unwrap_or(l))).unwrap_or_default(),
            bigip.first().cloned().unwrap_or_else(|| "-".into())
        ));
        if status.is_redirection() {
            let Some(l) = loc else { break };
            let Ok(next) = res.url().join(&l) else { break };
            req = client.get(next).header("Referer", REFERER).header("Origin", ORIGIN);
            if let Some(c) = static_cookies {
                req = req.header("Cookie", c);
            }
            continue;
        }
        let bytes = res.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
        return (bytes, trail.join(" | "));
    }
    (Vec::new(), trail.join(" | "))
}

async fn download_via_portal(
    app: &tauri::AppHandle,
    dir: &std::path::Path,
    name: &str,
    it: &TdsPick,
) -> Result<(), String> {
    let win = app
        .get_webview_window(IRD_LABEL)
        .ok_or("portal window is closed")?;
    let target = dir.join(format!("{name}.pdf"));
    let _ = std::fs::remove_file(&target);
    let js = format!(
        r#"(function(){{var f=document.createElement('form');f.method='POST';f.target='{name}';
f.action='/Reporting/TDS/ReportHandlers/TDSSubmissionReportHandler.ashx';
[['TranNo','{tran}'],['Status','{status}'],['formToken','a']].forEach(function(p){{var i=document.createElement('input');i.type='hidden';i.name=p[0];i.value=p[1];f.appendChild(i);}});
document.body.appendChild(f);f.submit();f.remove();}})();"#,
        tran = it.tran_no,
        status = it.status,
    );
    super::HIDE_POPUPS.store(true, std::sync::atomic::Ordering::Relaxed);
    win.eval(&js).map_err(|e| e.to_string())?;

    let mut last_len = 0u64;
    let mut result = Err("timed out waiting for the PDF".to_string());
    for _ in 0..100 {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        if let Ok(meta) = std::fs::metadata(&target) {
            let len = meta.len();
            if len > 1000 && len == last_len {
                result = match std::fs::read(&target) {
                    Ok(b) if b.starts_with(b"%PDF-") => Ok(()),
                    _ => Err("portal returned something that is not a PDF".to_string()),
                };
                break;
            }
            last_len = len;
        }
    }
    super::HIDE_POPUPS.store(false, std::sync::atomic::Ordering::Relaxed);
    super::close_popups(app);
    result
}

async fn download_one(
    app: &tauri::AppHandle,
    session: &Session,
    token: &str,
    dir: &std::path::Path,
    pan: &str,
    it: &TdsPick,
) -> Result<String, String> {
    if !safe(&it.tran_no) || !safe(&it.status) {
        return Err("bad row".into());
    }
    let name = format!("TDS_{pan}_{}.pdf", it.tran_no);
    let target = dir.join(&name);

    let curl_err = match run_curl(&session.ua, &session.cookie_header, token, it, &target).await {
        Ok(()) => match std::fs::read(&target) {
            Ok(b) if b.starts_with(b"%PDF-") => return Ok(name),
            Ok(b) => format!("curl got {} bytes, not a PDF", b.len()),
            Err(e) => format!("curl output unreadable: {e}"),
        },
        Err(e) => e,
    };
    let _ = std::fs::remove_file(&target);

    let nav_err = match download_via_portal(app, dir, name.trim_end_matches(".pdf"), it).await {
        Ok(()) => return Ok(name),
        Err(e) => e,
    };
    let _ = std::fs::remove_file(&target);

    let (bytes, trail) = run_flow(&session.jar_client, None, token, it).await;
    if bytes.starts_with(b"%PDF-") {
        std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
        return Ok(name);
    }
    Err(format!("{nav_err}; {curl_err}; fallback: {trail}"))
}
