use super::{downloads_dir, IRD_LABEL};
use reqwest::cookie::Jar;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Emitter, Manager, Url};

pub(super) const ORIGIN: &str = "https://taxpayerportal.ird.gov.np";
pub(super) const REFERER: &str = "https://taxpayerportal.ird.gov.np/taxpayer/app.html";
const GAP_MS: u64 = 1000;
const MAX_CONSECUTIVE_FAILS: usize = 3;
const CURL_ATTEMPTS: usize = 3;
const RETRY_GAP_MS: u64 = 700;

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

pub(super) struct Session {
    pub(super) jar_client: reqwest::Client,
    cookie_header: String,
    ua: String,
}

pub(super) fn session_client(app: &tauri::AppHandle, ua: &str) -> Result<Session, String> {
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

pub(super) fn after<'a>(hay: &'a str, key: &str) -> Option<&'a str> {
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

pub(super) fn safe(s: &str) -> bool {
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

pub(super) fn portal_rejected(txt: &str) -> bool {
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

pub(super) struct Report {
    pub path: &'static str,
    pub fields: Vec<(&'static str, String)>,
}

pub(super) struct Job {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub report: Report,
}

fn clean_part(s: &str) -> String {
    let swapped: String = s
        .chars()
        .map(|c| if c.is_control() || ['<', '>', ':', '"', '/', '\\', '|', '?', '*'].contains(&c) { ' ' } else { c })
        .collect();
    let joined = swapped.split_whitespace().collect::<Vec<_>>().join(" ");
    joined.trim_matches(|c: char| c == '.' || c == ' ').chars().take(80).collect::<String>().trim_end().to_string()
}

pub(super) fn client_folder(base: &std::path::Path, company: &str, pan: &str) -> String {
    let name = clean_part(company);
    let suffix = format!(" ({pan})");
    let mut named: Option<String> = None;
    let mut bare = false;
    if let Ok(rd) = std::fs::read_dir(base) {
        for e in rd.flatten() {
            if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let n = e.file_name().to_string_lossy().into_owned();
            if n == pan {
                bare = true;
            } else if named.is_none() && n.ends_with(&suffix) {
                named = Some(n);
            }
        }
    }
    if let Some(n) = named {
        if bare {
            merge_into(&base.join(pan), &base.join(&n));
        }
        return n;
    }
    if name.is_empty() {
        return pan.to_string();
    }
    let wanted = format!("{name}{suffix}");
    if bare && std::fs::rename(base.join(pan), base.join(&wanted)).is_err() {
        return pan.to_string();
    }
    wanted
}

fn merge_into(from: &std::path::Path, to: &std::path::Path) {
    let Ok(rd) = std::fs::read_dir(from) else {
        return;
    };
    for e in rd.flatten() {
        let src = e.path();
        let dst = to.join(e.file_name());
        if src.is_dir() {
            let _ = std::fs::create_dir_all(&dst);
            merge_into(&src, &dst);
        } else if !dst.exists() {
            let _ = std::fs::rename(&src, &dst);
        }
    }
    let _ = std::fs::remove_dir(from);
}

pub(super) fn folder_for(client: &str, kind: &str, fy: &str) -> String {
    let mut path = format!("{client}/{kind}");
    if !fy.is_empty() && fy.chars().all(|c| c.is_ascii_digit() || c == '-') {
        path.push('/');
        path.push_str(fy);
    }
    path
}

fn file_into_folder(base: &std::path::Path, folder: &str, name: &str) -> Result<(), String> {
    let dest_dir = folder.split('/').fold(base.to_path_buf(), |p, part| p.join(part));
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let from = base.join(name);
    let to = dest_dir.join(name);
    if std::fs::rename(&from, &to).is_err() {
        std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&from);
    }
    Ok(())
}

#[tauri::command]
pub async fn ird_download_tds(
    app: tauri::AppHandle,
    pan: String,
    items: Vec<TdsPick>,
    ua: String,
    company: String,
    fy: String,
) -> Result<Vec<DlResult>, String> {
    if !safe(&pan) {
        return Err("Bad PAN".into());
    }
    if items.iter().any(|it| !safe(&it.tran_no) || !safe(&it.status)) {
        return Err("bad row".into());
    }
    let session = session_client(&app, &ua)?;
    let token = form_token(&session.jar_client).await;
    let folder = folder_for(&client_folder(&downloads_dir(&app), &company, &pan), "TDS", &fy);
    let jobs = items
        .into_iter()
        .map(|it| Job {
            name: format!("TDS_{pan}_{}", it.tran_no),
            folder: folder.clone(),
            id: it.tran_no.clone(),
            report: Report {
                path: "/Reporting/TDS/ReportHandlers/TDSSubmissionReportHandler.ashx",
                fields: vec![
                    ("TranNo", it.tran_no),
                    ("Status", it.status),
                    ("formToken", token.clone()),
                ],
            },
        })
        .collect();
    Ok(run_batch(&app, &session, jobs).await)
}

pub(super) async fn run_batch(app: &tauri::AppHandle, session: &Session, jobs: Vec<Job>) -> Vec<DlResult> {
    let dir = downloads_dir(app);
    let total = jobs.len();
    let mut results = Vec::with_capacity(total);
    let mut fails_in_a_row = 0;

    for (i, job) in jobs.iter().enumerate() {
        let _ = app.emit("ird-progress", Progress { done: i, total });
        match download_one(app, session, &dir, job).await {
            Ok(name) => {
                fails_in_a_row = 0;
                let _ = file_into_folder(&dir, &job.folder, &name);
                results.push(DlResult { tran_no: job.id.clone(), ok: true, detail: name });
            }
            Err(e) => {
                fails_in_a_row += 1;
                results.push(DlResult { tran_no: job.id.clone(), ok: false, detail: e });
                if fails_in_a_row >= MAX_CONSECUTIVE_FAILS {
                    for rest in &jobs[i + 1..] {
                        results.push(DlResult {
                            tran_no: rest.id.clone(),
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
    results
}

async fn run_curl(ua: &str, cookies: &str, rep: &Report, out: &std::path::Path) -> Result<(), String> {
    let curl = std::path::Path::new(r"C:\Windows\System32\curl.exe");
    if !curl.exists() {
        return Err("curl.exe not found".into());
    }
    let mut cmd = tokio::process::Command::new(curl);
    cmd.arg("-s")
        .arg("-L")
        .arg("--max-redirs").arg("5")
        .arg("--max-time").arg("60")
        .arg("-o").arg(out)
        .arg("-A").arg(ua)
        .arg("-b").arg(cookies)
        .arg("-H").arg(format!("Referer: {REFERER}"))
        .arg("-H").arg(format!("Origin: {ORIGIN}"));
    for (k, v) in &rep.fields {
        cmd.arg("--data-urlencode").arg(format!("{k}={v}"));
    }
    let status = cmd
        .arg(format!("{ORIGIN}{}", rep.path))
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
    rep: &Report,
) -> (Vec<u8>, String) {
    let mut trail: Vec<String> = Vec::new();
    let form: Vec<(&str, &str)> = rep.fields.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let mut req = client
        .post(format!("{ORIGIN}{}", rep.path))
        .header("Referer", REFERER)
        .header("Origin", ORIGIN)
        .form(&form);
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
    rep: &Report,
) -> Result<(), String> {
    let js_safe = |v: &str| {
        !v.is_empty()
            && v.len() <= 200
            && v.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=+/".contains(c))
    };
    if !js_safe(name) || rep.fields.iter().any(|(_, v)| !js_safe(v)) {
        return Err("bad form value".into());
    }
    let win = app
        .get_webview_window(IRD_LABEL)
        .ok_or("portal window is closed")?;
    let target = dir.join(format!("{name}.pdf"));
    let _ = std::fs::remove_file(&target);
    let pairs = rep
        .fields
        .iter()
        .map(|(k, v)| format!("['{k}','{v}']"))
        .collect::<Vec<_>>()
        .join(",");
    let js = format!(
        r#"(function(){{var f=document.createElement('form');f.method='POST';f.target='{name}';
f.action='{path}';
[{pairs}].forEach(function(p){{var i=document.createElement('input');i.type='hidden';i.name=p[0];i.value=p[1];f.appendChild(i);}});
document.body.appendChild(f);f.submit();f.remove();}})();"#,
        path = rep.path,
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
    dir: &std::path::Path,
    job: &Job,
) -> Result<String, String> {
    let name = format!("{}.pdf", job.name);
    let target = dir.join(&name);
    let rep = &job.report;

    let mut curl_err = String::new();
    for attempt in 0..CURL_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(RETRY_GAP_MS)).await;
        }
        match run_curl(&session.ua, &session.cookie_header, rep, &target).await {
            Ok(()) => match std::fs::read(&target) {
                Ok(b) if b.starts_with(b"%PDF-") => return Ok(name),
                Ok(b) => curl_err = format!("curl got {} bytes, not a PDF (try {})", b.len(), attempt + 1),
                Err(e) => curl_err = format!("curl output unreadable: {e}"),
            },
            Err(e) => {
                curl_err = e;
                break;
            }
        }
    }
    let _ = std::fs::remove_file(&target);

    let nav_err = match download_via_portal(app, dir, &job.name, rep).await {
        Ok(()) => return Ok(name),
        Err(e) => e,
    };
    let _ = std::fs::remove_file(&target);

    let (bytes, trail) = run_flow(&session.jar_client, None, rep).await;
    if bytes.starts_with(b"%PDF-") {
        std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
        return Ok(name);
    }
    Err(format!("{nav_err}; {curl_err}; fallback: {trail}"))
}

#[cfg(test)]
mod folder_tests {
    use super::{client_folder, folder_for};
    use std::fs;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("nepad-ft-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn year_level_is_validated() {
        assert_eq!(folder_for("X (1)", "VAT", "2081-82"), "X (1)/VAT/2081-82");
        assert_eq!(folder_for("601466803", "TDS", ""), "601466803/TDS");
        assert_eq!(folder_for("601466803", "TDS", "../x"), "601466803/TDS");
    }

    #[test]
    fn names_are_cleaned_and_fall_back_to_pan() {
        let d = tmp("clean");
        assert_eq!(client_folder(&d, "Airline Reps Nepal Pvt.Ltd.", "601466803"), "Airline Reps Nepal Pvt.Ltd (601466803)");
        assert_eq!(client_folder(&d, "A/B: C*", "1"), "A B C (1)");
        assert_eq!(client_folder(&d, "", "601466803"), "601466803");
        assert_eq!(client_folder(&d, "..", "601466803"), "601466803");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn lookup_failure_never_splits_a_client() {
        let d = tmp("split");
        fs::create_dir_all(d.join("123456789/TDS/2081-82")).unwrap();
        fs::write(d.join("123456789/TDS/2081-82/a.pdf"), b"x").unwrap();
        assert_eq!(client_folder(&d, "ABC Traders", "123456789"), "ABC Traders (123456789)");
        assert!(d.join("ABC Traders (123456789)/TDS/2081-82/a.pdf").exists());
        assert!(!d.join("123456789").exists());
        assert_eq!(client_folder(&d, "", "123456789"), "ABC Traders (123456789)");
        assert_eq!(client_folder(&d, "ABC Traders Pvt Ltd", "123456789"), "ABC Traders (123456789)");
        fs::create_dir_all(d.join("123456789/VAT")).unwrap();
        fs::write(d.join("123456789/VAT/b.pdf"), b"y").unwrap();
        assert_eq!(client_folder(&d, "", "123456789"), "ABC Traders (123456789)");
        assert!(d.join("ABC Traders (123456789)/VAT/b.pdf").exists());
        assert!(!d.join("123456789").exists());
        let _ = fs::remove_dir_all(&d);
    }
}
