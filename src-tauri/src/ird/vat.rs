use super::downloads_dir;
use super::tds::{after, client_folder, folder_for, portal_rejected, run_batch, safe, session_client, DlResult, Job, Report, ORIGIN, REFERER};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize)]
pub struct VatRow {
    #[serde(rename = "submissionNo")]
    submission_no: String,
    #[serde(rename = "taxYear")]
    tax_year: String,
    #[serde(rename = "filingPeriod")]
    filing_period: String,
    period: String,
    #[serde(rename = "submissionDate")]
    submission_date: String,
}

#[derive(Deserialize)]
pub struct VatPick {
    #[serde(rename = "submissionNo")]
    submission_no: String,
    #[serde(rename = "taxYear")]
    tax_year: String,
    #[serde(rename = "filingPeriod")]
    filing_period: String,
    period: String,
}

const MONTHS: [&str; 12] = [
    "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
];

fn file_stem(it: &VatPick, pan: &str) -> String {
    let month = it.period.parse::<usize>().ok().filter(|p| (1..=12).contains(p));
    let label = match (it.filing_period.as_str(), month) {
        ("M", Some(p)) => MONTHS[p - 1].to_string(),
        (fp, _) => format!("{fp}{}", it.period),
    };
    format!("{label}_{}_VAT_{pan}", it.tax_year)
}

fn fiscal_year(it: &VatPick) -> String {
    let (Ok(y), Ok(m)) = (it.tax_year.parse::<u32>(), it.period.parse::<u32>()) else {
        return String::new();
    };
    let start = if it.filing_period == "M" && m < 4 { y.saturating_sub(1) } else { y };
    format!("{start}-{:02}", (start + 1) % 100)
}

fn unique_name(seen: &mut HashMap<String, usize>, stem: String) -> String {
    let n = seen.entry(stem.clone()).or_insert(0);
    *n += 1;
    if *n == 1 { stem } else { format!("{stem}_{n}") }
}

fn parse_rows(txt: &str) -> Vec<VatRow> {
    let mut rows = Vec::new();
    for chunk in txt.split('{').skip(1) {
        let obj = chunk.split('}').next().unwrap_or("");
        let digits = |key: &str| -> String {
            after(obj, key)
                .map(|r| r.chars().take_while(|c| c.is_ascii_digit()).collect())
                .unwrap_or_default()
        };
        let quoted = |key: &str| {
            after(obj, key)
                .and_then(|r| r.split('"').next())
                .unwrap_or("")
                .to_string()
        };
        let submission_no = quoted("\"SubmissionNo\":\"");
        if submission_no.is_empty() {
            continue;
        }
        rows.push(VatRow {
            submission_no,
            tax_year: digits("\"Taxyear\":"),
            filing_period: quoted("\"FilingPeriod\":\""),
            period: digits("\"Period\":"),
            submission_date: quoted("\"SubmissionDate\":\""),
        });
    }
    rows
}

#[tauri::command]
pub async fn ird_list_vat(app: tauri::AppHandle, pan: String, ua: String) -> Result<Vec<VatRow>, String> {
    if !safe(&pan) {
        return Err("PAN must be digits only".into());
    }
    let client = session_client(&app, &ua)?.jar_client;
    let res = client
        .post(format!("{ORIGIN}/Handlers/VAT/VatReturnsHandler.ashx?method=GetVatReturnList"))
        .header("Referer", REFERER)
        .header("Origin", ORIGIN)
        .header("Accept", "application/json, text/javascript, */*; q=0.01")
        .header("X-Requested-With", "XMLHttpRequest")
        .form(&[
            ("offCode", ""),
            ("pan", pan.as_str()),
            ("status", ""),
            ("selectionType", "V"),
            ("taxyear", ""),
            ("filingPeriod", ""),
            ("period", ""),
            ("fromDate", ""),
            ("toDate", ""),
            ("formToken", "a"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let txt = res.text().await.map_err(|e| e.to_string())?;
    if portal_rejected(&txt) || !txt.contains("root:[") {
        return Err("Portal did not accept the list request (session expired? log in again)".into());
    }
    Ok(parse_rows(&txt))
}

#[tauri::command]
pub async fn ird_download_vat(
    app: tauri::AppHandle,
    pan: String,
    items: Vec<VatPick>,
    ua: String,
    company: String,
) -> Result<Vec<DlResult>, String> {
    if !safe(&pan) {
        return Err("Bad PAN".into());
    }
    if items
        .iter()
        .any(|it| !safe(&it.submission_no) || !safe(&it.tax_year) || !safe(&it.filing_period) || !safe(&it.period))
    {
        return Err("bad row".into());
    }
    let session = session_client(&app, &ua)?;
    let mut seen: HashMap<String, usize> = HashMap::new();
    let client = client_folder(&downloads_dir(&app), &company, &pan);
    let jobs = items
        .into_iter()
        .map(|it| Job {
            name: unique_name(&mut seen, file_stem(&it, &pan)),
            folder: folder_for(&client, "VAT", &fiscal_year(&it)),
            id: it.submission_no.clone(),
            report: Report {
                path: "/Reporting/Vat/ReportHandlers/Returns/FinalizedReturns.ashx",
                fields: vec![
                    ("submissionNo", it.submission_no),
                    ("pan", pan.clone()),
                    ("acctType", "00".to_string()),
                    ("taxyear", it.tax_year),
                    ("filingPeriod", it.filing_period),
                    ("period", it.period),
                    ("from", "VRSL".to_string()),
                ],
            },
        })
        .collect();
    Ok(run_batch(&app, &session, jobs).await)
}

#[cfg(test)]
mod fy_tests {
    use super::{fiscal_year, VatPick};

    fn pick(y: &str, m: &str) -> VatPick {
        VatPick { submission_no: "1".into(), tax_year: y.into(), filing_period: "M".into(), period: m.into() }
    }

    #[test]
    fn shrawan_starts_the_fiscal_year() {
        assert_eq!(fiscal_year(&pick("2081", "12")), "2081-82");
        assert_eq!(fiscal_year(&pick("2082", "2")), "2081-82");
        assert_eq!(fiscal_year(&pick("2082", "4")), "2082-83");
    }
}
