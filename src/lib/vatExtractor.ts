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

async function parseVatPdf(bytes: Uint8Array, filename: string): Promise<VatRecord> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")).default;
  GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await getDocument({ data: bytes }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const pageH = page.getViewport({ scale: 1 }).height;

  const words: Word[] = [];
  for (const item of content.items as any[]) {
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

  const rowAt = (yRef: number, tol = 7) =>
    words.filter((w) => Math.abs(w.yC - yRef) < tol).sort((a, b) => a.x0 - b.x0);
  const findY = (exact: string, xMax = 160) => {
    const w = words.find((w) => w.x0 < xMax && w.text === exact);
    return w ? w.yC : null;
  };
  const rowNums = (row: Word[], minX = 220): [string | null, string | null] => {
    const ns = row.filter((w) => w.x0 >= minX && /[\d-]/.test(w.text));
    return [ns[0]?.text ?? null, ns[1]?.text ?? null];
  };
  const row = (marker: string): [string | null, string | null] => {
    const y = findY(marker);
    return y != null ? rowNums(rowAt(y)) : [null, null];
  };
  const singleRowVal = (marker: string): string | null => {
    const y = findY(marker);
    if (y == null) return null;
    const ns = rowAt(y).filter((w) => w.x0 >= 220 && /[\d-]/.test(w.text));
    return ns[0]?.text ?? null;
  };

  const byRow: Record<number, Word[]> = {};
  for (const w of words) {
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
  rec["PAN No"] = m(/पयपन\s*नस\.?\s*:?\s*(\d+)/);
  rec["Tax Year"] = m(/टपकस\s*सरर\s*:\s*(\d+)/);
  rec["Tax Month"] = m(/असनन\.?\s*:\s*(\d+)/);

  const dateWord = words.find((w) => /नमनत:\d{4}\.\d{2}\.\d{2}/.test(w.text));
  rec["Filed Date"] = dateWord
    ? dateWord.text.replace("नमनत:", "")
    : m(/नमनत:\s*(\d{4}\.\d{2}\.\d{2})/);

  let [a, b] = row("१.१.");
  rec["Taxable Sales"] = cleanNum(a);
  rec["Sales VAT"] = cleanNum(b);
  [a] = row("१.२.");
  rec["Export Sales"] = cleanNum(a);
  [a] = row("१.३.");
  rec["Exempt Sales"] = cleanNum(a);
  [a, b] = row("२.१.");
  rec["Local Purchase"] = cleanNum(a);
  rec["Input VAT"] = cleanNum(b);
  [a, b] = row("२.२.");
  rec["Import Purchase"] = cleanNum(a);
  rec["Import VAT"] = cleanNum(b);
  [a] = row("२.३.");
  rec["Exempt Local"] = cleanNum(a);
  [a] = row("२.४.");
  rec["Exempt Import"] = cleanNum(a);
  [a, b] = row("३.१.");
  rec["Thapghat Credit"] = cleanNum(a);
  rec["Thapghat Debit"] = cleanNum(b);
  [a, b] = row("४.");
  rec["Total Credit"] = cleanNum(a);
  rec["Total Debit"] = cleanNum(b);
  rec["Net Tax"] = cleanNum(singleRowVal("५."));
  rec["Prev Month Credit"] = cleanNum(singleRowVal("६."));
  rec["Net Payable"] = cleanNum(singleRowVal("७."));

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
