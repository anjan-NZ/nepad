import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { resolveResource } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { escapeHtml } from "./escapeHtml";

interface PickedFile {
  path: string;
  name: string;
}

interface VatRecord {
  File: string;
  "PAN No": string;
  "Tax Year": string;
  "Tax Month": string;
  "Filed Date": string;
  "Taxable Sales": number | null;
  "Sales VAT": number | null;
  "Export Sales": number | null;
  "Exempt Sales": number | null;
  "Local Purchase": number | null;
  "Input VAT": number | null;
  "Import Purchase": number | null;
  "Import VAT": number | null;
  "Exempt Local": number | null;
  "Exempt Import": number | null;
  "Thapghat Credit": number | null;
  "Thapghat Debit": number | null;
  "Total Credit": number | null;
  "Total Debit": number | null;
  "Net Tax": number | null;
  "Prev Month Credit": number | null;
  "Net Payable": number | null;
}

const VAT_HEADERS: (keyof VatRecord)[] = [
  "File",
  "PAN No",
  "Tax Year",
  "Tax Month",
  "Filed Date",
  "Taxable Sales",
  "Sales VAT",
  "Export Sales",
  "Exempt Sales",
  "Local Purchase",
  "Input VAT",
  "Import Purchase",
  "Import VAT",
  "Exempt Local",
  "Exempt Import",
  "Thapghat Credit",
  "Thapghat Debit",
  "Total Credit",
  "Total Debit",
  "Net Tax",
  "Prev Month Credit",
  "Net Payable",
];

const NEP: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};
const nepToAra = (s: string) => s.split("").map((c) => NEP[c] ?? c).join("");

function cleanNum(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = nepToAra(String(v)).replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!s || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

interface Word {
  text: string;
  x0: number;
  yC: number;
  yTop: number;
}

interface Row {
  yC: number;
  words: Word[];
  /** Leading serial number of the row ("1.1.", "4."), Nepali digits normalised. "" if none. */
  marker: string;
}

function pageWords(items: any[], pageH: number): Word[] {
  const words: Word[] = [];
  for (const item of items) {
    const str = (item.str ?? "").trim();
    if (!str) continue;
    const x = item.transform[4];
    const yBot = pageH - item.transform[5];
    const h = Math.abs(item.height) || 10;
    const yTop = yBot - h;
    const yC = (yTop + yBot) / 2;
    const parts = str.split(/\s+/);
    let cx = x;
    for (const p of parts) {
      if (p) {
        words.push({ text: p, x0: cx, yC, yTop });
        cx += item.width / parts.length;
      }
    }
  }
  words.sort((a, b) => a.yTop - b.yTop || a.x0 - b.x0);
  return words;
}

/** Groups words into visual rows and rebuilds each row's leading serial number.
 *
 * The 2083-era IRD PDFs split "१.१." into four items across two fonts (Nepali digits in the
 * Devanagari font, the dots in the Latin one), so the marker can no longer be matched as a
 * single token — it has to be re-joined from the leading digit/dot run.
 */
function buildRows(words: Word[], tol = 5): Row[] {
  const rows: Row[] = [];
  for (const w of [...words].sort((a, b) => a.yC - b.yC || a.x0 - b.x0)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(w.yC - last.yC) <= tol) {
      last.words.push(w);
      last.yC = (last.yC * (last.words.length - 1) + w.yC) / last.words.length;
    } else {
      rows.push({ yC: w.yC, words: [w], marker: "" });
    }
  }
  for (const r of rows) {
    r.words.sort((a, b) => a.x0 - b.x0);
    let key = "";
    for (const w of r.words) {
      if (w.x0 > 160) break;
      const t = nepToAra(w.text);
      if (!/^[0-9.]+$/.test(t)) break;
      key += t;
    }
    r.marker = key;
  }
  return rows;
}

const digitsOf = (s: string) => nepToAra(s).replace(/\D/g, "");

/** Ports the standalone `nepal_vat_extractor.html` tool's PDF parser into NePad.
 *
 * Row values are found by anchoring on a row's Nepali serial number (e.g. "१.१." for the
 * taxable-sales row) and reading the numbers to its right, rather than by fixed columns — the
 * same word-coordinate technique already used by the TDS Extractor's PDF parser
 * (`lib/tds/parsePdf.ts`), since the same pdf.js text-layer quirks apply.
 *
 * Two Anusuchi-10 layouts are in circulation and both are handled. The older one is a single
 * page whose garbled label text is stable enough to regex; the newer one bundles the return as
 * page 1 of a many-page file with the purchase/sales annexures behind it, drops most Devanagari
 * label glyphs entirely, and splits the row markers across fonts. Every lookup therefore tries
 * the original exact-token/label match first and falls back to a layout-independent one, so old
 * files keep parsing exactly as they did.
 */
async function parseVatPdf(bytes: Uint8Array, filename: string): Promise<VatRecord> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")).default;
  GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await getDocument({ data: bytes }).promise;

  let words: Word[] | null = null;
  let rows: Row[] = [];
  let firstPage: Word[] | null = null;
  for (let p = 1; p <= Math.min(doc.numPages, 5) && !words; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pw = pageWords(content.items as any[], page.getViewport({ scale: 1 }).height);
    if (p === 1) firstPage = pw;
    const pr = buildRows(pw);
    if (pr.some((r) => r.marker === "1.1.") && pr.some((r) => r.marker === "4.")) {
      words = pw;
      rows = pr;
    }
  }
  if (!words) {
    words = firstPage ?? [];
    rows = buildRows(words);
  }
  const ws = words;

  const rowAt = (yRef: number, tol = 7) =>
    ws.filter((w) => Math.abs(w.yC - yRef) < tol).sort((a, b) => a.x0 - b.x0);
  const findY = (exact: string, xMax = 160) => {
    const w = ws.find((w) => w.x0 < xMax && w.text === exact);
    return w ? w.yC : null;
  };
  const legacyVals = (marker: string): string[] => {
    const y = findY(marker);
    if (y == null) return [];
    return rowAt(y)
      .filter((w) => w.x0 >= 220 && /[\d-]/.test(w.text))
      .map((w) => w.text);
  };
  const genericVals = (marker: string): string[] => {
    const r = rows.find((r) => r.marker === nepToAra(marker));
    if (!r) return [];
    return r.words.filter((w) => w.x0 >= 200 && cleanNum(w.text) != null).map((w) => w.text);
  };
  const vals = (marker: string): string[] => {
    const v = legacyVals(marker);
    return v.length ? v : genericVals(marker);
  };

  const byRow: Record<number, Word[]> = {};
  for (const w of ws) {
    const k = Math.round(w.yTop / 5) * 5;
    (byRow[k] ??= []).push(w);
  }
  const text = Object.keys(byRow)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => byRow[k].sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" "))
    .join("\n");
  const m = (rx: RegExp) => text.match(rx)?.[1] ?? "";

  const rec: Partial<VatRecord> = { File: filename };

  // Header fields sit above the table; restricting the fallback search there keeps the 9-digit
  // PAN rule from matching a 9-digit amount further down the page.
  const tableTop = rows.find((r) => r.marker === "1.1.")?.yC ?? Number.MAX_SAFE_INTEGER;
  const head = ws.filter((w) => w.yC < tableTop - 5);

  rec["PAN No"] = m(/पयपन\s*नस\.?\s*:?\s*(\d+)/);
  if (!rec["PAN No"]) {
    const w = head.find((w) => digitsOf(w.text).length === 9);
    rec["PAN No"] = w ? digitsOf(w.text) : "";
  }

  rec["Tax Year"] = m(/टपकस\s*सरर\s*:\s*(\d+)/);
  let yearWord: Word | undefined;
  if (!rec["Tax Year"]) {
    yearWord = head.find((w) => /^[^\d]{0,3}(20\d{2}|21\d{2})$/.test(nepToAra(w.text)));
    rec["Tax Year"] = yearWord ? digitsOf(yearWord.text) : "";
  }

  rec["Tax Month"] = m(/असनन\.?\s*:\s*(\d+)/);
  if (!rec["Tax Month"] && yearWord) {
    // The period number shares the year's row, written as a labelled value like "अवधि.:1".
    const yw = yearWord;
    const cand = ws
      .filter((w) => w !== yw && Math.abs(w.yC - yw.yC) < 6 && /[.:]/.test(w.text))
      .map((w) => ({ w, d: digitsOf(w.text) }))
      .filter((o) => o.d.length > 0 && o.d.length <= 2 && +o.d >= 1 && +o.d <= 12)
      .sort((a, b) => a.w.x0 - b.w.x0);
    rec["Tax Month"] = cand.length ? String(+cand[cand.length - 1].d) : "";
  }

  const dateWord = ws.find((w) => /नमनत:\d{4}\.\d{2}\.\d{2}/.test(w.text));
  rec["Filed Date"] = dateWord
    ? dateWord.text.replace("नमनत:", "")
    : m(/नमनत:\s*(\d{4}\.\d{2}\.\d{2})/);
  if (!rec["Filed Date"]) {
    const w = [...ws].reverse().find((w) => /(2[01]\d{2}\.\d{2}\.\d{2})$/.test(w.text));
    rec["Filed Date"] = w
      ? w.text.match(/(2[01]\d{2}\.\d{2}\.\d{2})$/)![1]
      : (text.match(/\b(2[01]\d{2}\.\d{2}\.\d{2})\b/)?.[1] ?? "");
  }

  const put = (marker: string, k1: keyof VatRecord, k2?: keyof VatRecord) => {
    const v = vals(marker);
    (rec as any)[k1] = cleanNum(v[0]);
    if (k2) (rec as any)[k2] = cleanNum(v[1]);
  };
  put("१.१.", "Taxable Sales", "Sales VAT");
  put("१.२.", "Export Sales");
  put("१.३.", "Exempt Sales");
  put("२.१.", "Local Purchase", "Input VAT");
  put("२.२.", "Import Purchase", "Import VAT");
  put("२.३.", "Exempt Local");
  put("२.४.", "Exempt Import");
  put("३.१.", "Thapghat Credit", "Thapghat Debit");
  put("४.", "Total Credit", "Total Debit");
  put("५.", "Net Tax");
  put("६.", "Prev Month Credit");
  put("७.", "Net Payable");

  return rec as VatRecord;
}

function fmtNum(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function renderVatExtractor(root: HTMLElement): void {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">VAT Return Extractor</h2>
      <button type="button" class="details-toggle" id="vat-details-toggle">Details...</button>
      <p class="pan-hint hidden" id="vat-details">
        Select one or more Anusuchi-10 (VAT return) PDFs to consolidate into one Excel
        workbook. Each file's PAN, sales, purchase, and tax-summary figures are read off
        page 1 directly. Verify totals before filing.
        Need only specific columns instead of every field? Open the
        <a href="#" id="vat-standalone-link">original VAT Extractor tool</a> for selective
        column export. Read more about the original tool in
        <a href="#" id="vat-linkedin-link">this LinkedIn post</a>.
      </p>

      <div class="tds-pick-row">
        <button type="button" id="vat-pick-files" class="icon-btn pan-pick-btn">Choose Files...</button>
        <span id="vat-file-count" class="pan-file-name">No files chosen</span>
        <button type="button" id="vat-clear" class="clear-btn hidden">Clear</button>
      </div>
      <ul id="vat-file-list" class="tds-file-list"></ul>

      <button type="button" id="vat-extract" class="conv-go-btn" disabled>Extract</button>
      <div id="vat-progress" class="pan-bulk-progress"></div>
      <div id="vat-summary" class="tds-summary"></div>

      <div class="tds-actions hidden" id="vat-actions">
        <button type="button" id="vat-export" class="icon-btn">Export Excel...</button>
      </div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#vat-details-toggle")!.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const details = root.querySelector<HTMLElement>("#vat-details")!;
    const showing = details.classList.toggle("hidden") === false;
    btn.textContent = showing ? "Hide details" : "Details...";
  });

  root.querySelector<HTMLAnchorElement>("#vat-standalone-link")!.addEventListener("click", async (e) => {
    e.preventDefault();
    const path = await resolveResource("resources/vat-extractor-standalone.html");
    await openPath(path);
  });

  root.querySelector<HTMLAnchorElement>("#vat-linkedin-link")!.addEventListener("click", async (e) => {
    e.preventDefault();
    await openUrl(
      "https://www.linkedin.com/posts/anjan-simkhada_im-excited-to-share-a-new-web-app-tool-i-share-7444936888294989826-X1Vy/?utm_source=share&utm_medium=member_desktop&rcm=ACoAAFTloRIBeydWNjRk6HTkOB5yxwi5EdI7E40",
    );
  });

  const pickBtn = root.querySelector<HTMLButtonElement>("#vat-pick-files")!;
  const fileCountEl = root.querySelector<HTMLElement>("#vat-file-count")!;
  const clearBtn = root.querySelector<HTMLButtonElement>("#vat-clear")!;
  const fileListEl = root.querySelector<HTMLElement>("#vat-file-list")!;
  const extractBtn = root.querySelector<HTMLButtonElement>("#vat-extract")!;
  const progressEl = root.querySelector<HTMLElement>("#vat-progress")!;
  const summaryEl = root.querySelector<HTMLElement>("#vat-summary")!;
  const actionsEl = root.querySelector<HTMLElement>("#vat-actions")!;
  const exportBtn = root.querySelector<HTMLButtonElement>("#vat-export")!;

  let files: PickedFile[] = [];
  let records: VatRecord[] = [];

  function renderFileList() {
    fileCountEl.textContent = files.length === 0 ? "No files chosen" : `${files.length} file(s) chosen`;
    clearBtn.classList.toggle("hidden", files.length === 0 && records.length === 0);
    fileListEl.innerHTML = files
      .map(
        (f, i) => `
        <li class="tds-file-item" data-i="${i}">
          <span class="tds-file-name">${escapeHtml(f.name)}</span>
          <button type="button" class="task-del" title="Remove">&times;</button>
        </li>`,
      )
      .join("");
    fileListEl.querySelectorAll<HTMLButtonElement>(".task-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const li = btn.closest<HTMLElement>(".tds-file-item")!;
        files.splice(Number(li.dataset.i), 1);
        renderFileList();
        extractBtn.disabled = files.length === 0;
      });
    });
  }

  function renderSummary() {
    if (records.length === 0) {
      summaryEl.innerHTML = "";
      return;
    }
    const totalSales = records.reduce((s, r) => s + (r["Taxable Sales"] ?? 0), 0);
    const totalNet = records.reduce((s, r) => s + (r["Net Tax"] ?? 0), 0);
    const totalPay = records.reduce((s, r) => s + (r["Net Payable"] ?? 0), 0);
    const rowsHtml = records
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.File)}</td>
          <td>${escapeHtml(r["PAN No"] ?? "")}</td>
          <td>${fmtNum(r["Taxable Sales"])}</td>
          <td>${fmtNum(r["Net Tax"])}</td>
          <td>${fmtNum(r["Net Payable"])}</td>
        </tr>`,
      )
      .join("");
    summaryEl.innerHTML = `
      <table class="pan-table tds-summary-table">
        <thead><tr><th>File</th><th>PAN</th><th>Taxable Sales</th><th>Net Tax</th><th>Net Payable</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="2"><b>Total</b></td>
          <td><b>${fmtNum(totalSales)}</b></td>
          <td><b>${fmtNum(totalNet)}</b></td>
          <td><b>${fmtNum(totalPay)}</b></td>
        </tr></tfoot>
      </table>
    `;
  }

  pickBtn.addEventListener("click", async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "VAT Return", extensions: ["pdf"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    files = paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }));
    renderFileList();
    extractBtn.disabled = files.length === 0;
    actionsEl.classList.add("hidden");
    summaryEl.innerHTML = "";
    progressEl.textContent = "";
    progressEl.classList.remove("is-active", "is-done");
  });

  clearBtn.addEventListener("click", () => {
    files = [];
    records = [];
    renderFileList();
    extractBtn.disabled = true;
    actionsEl.classList.add("hidden");
    summaryEl.innerHTML = "";
    progressEl.textContent = "";
    progressEl.classList.remove("is-active", "is-done");
  });

  extractBtn.addEventListener("click", async () => {
    extractBtn.disabled = true;
    records = [];
    const errors: string[] = [];

    progressEl.classList.add("is-active");
    progressEl.classList.remove("is-done");
    for (let i = 0; i < files.length; i++) {
      progressEl.textContent = `Parsing ${i + 1}/${files.length}: ${files[i].name}...`;
      try {
        const bytes = await readFile(files[i].path);
        records.push(await parseVatPdf(bytes, files[i].name));
      } catch (err) {
        errors.push(`${files[i].name}: ${(err as Error).message ?? String(err)}`);
      }
    }

    progressEl.classList.remove("is-active");
    progressEl.classList.add("is-done");
    progressEl.textContent = `Done. ${records.length} file(s) extracted.${
      errors.length ? ` ${errors.length} file(s) failed.` : ""
    }`;
    if (errors.length) {
      summaryEl.innerHTML = `<div class="conv-error">${errors.join("<br>")}</div>`;
    }
    renderSummary();
    extractBtn.disabled = false;
    actionsEl.classList.toggle("hidden", records.length === 0);
  });

  exportBtn.addEventListener("click", async () => {
    const target = await save({
      defaultPath: "VAT_Extracted.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!target) return;
    const headerRows = records.map((r) =>
      VAT_HEADERS.map((h) => {
        const v = r[h];
        return v == null ? "" : typeof v === "number" ? v.toFixed(2) : v;
      }),
    );
    await invoke("write_excel_multi", {
      path: target,
      sheets: [{ name: "VAT Returns", headers: VAT_HEADERS, rows: headerRows }],
    });
    progressEl.textContent = `Exported to ${target}`;
  });
}
