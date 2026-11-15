use super::tds::{client_folder, folder_for, portal_rejected, safe, session_client, ORIGIN, REFERER};
use super::downloads_dir;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct ExportResult {
    name: String,
    ok: bool,
    detail: String,
}

const HEADERS: [&str; 8] = ["Paying Office", "Revenue Account", "Voucher No", "Voucher Date", "Bank", "FY", "Amount", "Module"];
const KEYS: [&str; 8] = ["PayingOffice", "RevenueAccount", "VoucherNo", "VoucherDate", "BankCode", "FY", "Amount", "Module"];

fn parse_root(txt: &str) -> Result<Vec<Value>, String> {
    let start = txt.find("root:[").ok_or("no data in the portal reply")? + 5;
    let (mut depth, mut in_str, mut esc, mut end) = (0i32, false, false, None);
    for (i, c) in txt[start..].char_indices() {
        if in_str {
            if esc { esc = false } else if c == '\\' { esc = true } else if c == '"' { in_str = false }
            continue;
        }
        match c {
            '"' => in_str = true,
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(start + i + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let end = end.ok_or("portal reply was cut off")?;
    serde_json::from_str(&txt[start..end]).map_err(|e| e.to_string())
}

async fn fetch(client: &reqwest::Client, method: &str, voucher: String) -> Result<Vec<Value>, String> {
    let res = client
        .get(format!("{ORIGIN}/Handlers/RAS/PanCollectionHandler.ashx"))
        .query(&[
            ("method", method),
            ("Voucher", voucher.as_str()),
            ("formToken", "a"),
            ("page", "1"),
            ("start", "0"),
            ("limit", "5000"),
        ])
        .header("Referer", REFERER)
        .header("Accept", "application/json, text/javascript, */*; q=0.01")
        .header("X-Requested-With", "XMLHttpRequest")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let txt = res.text().await.map_err(|e| e.to_string())?;
    if portal_rejected(&txt) || !txt.contains("root:[") {
        return Err("Portal did not accept the request (session expired? log in again)".into());
    }
    parse_root(&txt)
}

fn text_of(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Null) | None => String::new(),
        Some(o) => o.to_string(),
    }
}

fn write_xlsx(path: &std::path::Path, rows: &[Value]) -> Result<(), String> {
    use rust_xlsxwriter::{Format, Workbook};
    let mut wb = Workbook::new();
    let sheet = wb.add_worksheet();
    let font = Format::new().set_font_name("Garamond");
    let bold = Format::new().set_font_name("Garamond").set_bold();
    for (c, h) in HEADERS.iter().enumerate() {
        sheet.write_string_with_format(0, c as u16, *h, &bold).map_err(|e| e.to_string())?;
    }
    for (r, row) in rows.iter().enumerate() {
        for (c, key) in KEYS.iter().enumerate() {
            let t = text_of(row, key);
            let (r, c) = ((r + 1) as u32, c as u16);
            match (*key == "Amount", t.parse::<f64>()) {
                (true, Ok(n)) => sheet.write_number_with_format(r, c, n, &font),
                _ => sheet.write_string_with_format(r, c, &t, &font),
            }
            .map_err(|e| e.to_string())?;
        }
    }
    sheet.autofit();
    wb.save(path).map_err(|e| e.to_string())?;
    Ok(())
}

fn save(app: &tauri::AppHandle, folder: &str, name: &str, rows: &[Value]) -> Result<(), String> {
    let dir = folder.split('/').fold(downloads_dir(app), |p, part| p.join(part));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_xlsx(&dir.join(format!("{name}.xlsx")), rows)
}

fn done(name: String, r: Result<usize, String>) -> ExportResult {
    match r {
        Ok(n) => ExportResult { name, ok: true, detail: format!("{n} row(s)") },
        Err(e) => ExportResult { name, ok: false, detail: e },
    }
}

#[tauri::command]
pub async fn ird_export_vouchers(
    app: tauri::AppHandle,
    pan: String,
    from: String,
    to: String,
    ua: String,
    company: String,
    fy: String,
) -> Result<ExportResult, String> {
    if !safe(&pan) || !safe(&from) || !safe(&to) {
        return Err("PAN and dates must be digits/dots only".into());
    }
    let client = session_client(&app, &ua)?.jar_client;
    let voucher = format!(r#"{{"Pan":"{pan}","StartDate":"{from}","EndDate":"{to}"}}"#);
    let name = format!("PaidVouchers_{from}_to_{to}_{pan}");
    let r = async {
        let rows = fetch(&client, "GetPanVouchers", voucher).await?;
        if rows.is_empty() {
            return Err("No vouchers in this range".to_string());
        }
        let client_dir = client_folder(&downloads_dir(&app), &company, &pan);
        save(&app, &folder_for(&client_dir, "Vouchers", &fy), &name, &rows)?;
        Ok(rows.len())
    }
    .await;
    Ok(done(name, r))
}

#[tauri::command]
pub async fn ird_export_annex10(
    app: tauri::AppHandle,
    pan: String,
    years: Vec<u32>,
    ua: String,
    company: String,
) -> Result<Vec<ExportResult>, String> {
    if !safe(&pan) {
        return Err("Bad PAN".into());
    }
    let client = session_client(&app, &ua)?.jar_client;
    let mut out = Vec::new();
    for y in years {
        let label = format!("{y}-{:02}", (y + 1) % 100);
        let name = format!("Annex10_{label}_{pan}");
        let voucher = format!(r#"{{"Pan":"{pan}","Fy":"{y}.{:03}"}}"#, (y + 1) % 1000);
        let r = async {
            let rows = fetch(&client, "GetPanAnnex10Vouchers", voucher).await?;
            if rows.is_empty() {
                return Err("Nothing listed for this year".to_string());
            }
            let client_dir = client_folder(&downloads_dir(&app), &company, &pan);
            save(&app, &folder_for(&client_dir, "Annex10", &label), &name, &rows)?;
            Ok(rows.len())
        }
        .await;
        out.push(done(name, r));
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    }
    Ok(out)
}
