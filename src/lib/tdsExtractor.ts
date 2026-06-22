import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { parseTdsFile, TdsFileMeta, TdsRecord } from "./tds";
import { searchOne } from "./pan";
import { escapeHtml } from "./escapeHtml";

interface PickedFile {
  path: string;
  name: string;
}

interface ExcelSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

function buildSheets(records: TdsRecord[], metas: TdsFileMeta[]): ExcelSheet[] {
  const txnHeaders = [
    "S.N.",
    "PAN",
    "Vendor Name (Nepali)",
    "Vendor Name (English)",
    "Date",
    "Date Type",
    "Revenue Code",
    "Revenue Type",
    "Payment Amount",
    "TDS Amount",
    "Source File",
  ];
  const txnRows = records.map((r) => [
    r.sn,
    r.pan,
    r.nameNepali,
    r.nameEnglish,
    r.date,
    r.dateType,
    r.headingCode,
    r.headingLabel,
    r.payment.toFixed(2),
    r.tds.toFixed(2),
    r.sourceFile,
  ]);

  const fileHeaders = [
    "File",
    "Format",
    "Period From",
    "Period To",
    "Submission No.",
    "Record Verified Date",
    "Transaction Count",
    "Total Payment",
    "Total TDS",
  ];
  const fileRows = metas.map((m) => {
    const recs = records.filter((r) => r.sourceFile === m.sourceFile);
    const totalPayment = recs.reduce((s, r) => s + r.payment, 0);
    const totalTds = recs.reduce((s, r) => s + r.tds, 0);
    return [
      m.sourceFile,
      m.format,
      m.periodFrom,
      m.periodTo,
      m.submissionNo,
      m.recordVerifiedDate,
      String(recs.length),
      totalPayment.toFixed(2),
      totalTds.toFixed(2),
    ];
  });

  const headingHeaders = [
    "Revenue Code",
    "Revenue Type",
    "Transaction Count",
    "Total Payment",
    "Total TDS",
  ];
  const headingMap = new Map<string, { label: string; count: number; payment: number; tds: number }>();
  for (const r of records) {
    const entry = headingMap.get(r.headingCode) ?? {
      label: r.headingLabel,
      count: 0,
      payment: 0,
      tds: 0,
    };
    entry.count += 1;
    entry.payment += r.payment;
    entry.tds += r.tds;
    headingMap.set(r.headingCode, entry);
  }
  const headingRows = [...headingMap.entries()].map(([code, e]) => [
    code,
    e.label,
    String(e.count),
    e.payment.toFixed(2),
    e.tds.toFixed(2),
  ]);

  return [
    { name: "Transactions", headers: txnHeaders, rows: txnRows },
    { name: "Summary by File", headers: fileHeaders, rows: fileRows },
    { name: "Summary by Heading", headers: headingHeaders, rows: headingRows },
  ];
}

export function renderTdsExtractor(root: HTMLElement): void {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">TDS Return Extractor</h2>
      <button type="button" class="details-toggle" id="tds-details-toggle">Details...</button>
      <p class="pan-hint hidden" id="tds-details">
        Select one or more IRD TDS Return files (PDF, ZIP-format download, or a saved
        .aspx/.html page) to consolidate into one Excel workbook. The Nepali vendor name
        extracted from a real PDF may render garbled (IRD's printed-PDF font remaps
        Devanagari letters), and the return has no English name at all. Use
        "Resolve Names" after extracting to fill in both the correct Nepali name and the
        English name via the PAN Lookup tool.
      </p>

      <div class="tds-pick-row">
        <button type="button" id="tds-pick-files" class="icon-btn pan-pick-btn">Choose Files...</button>
        <span id="tds-file-count" class="pan-file-name">No files chosen</span>
        <button type="button" id="tds-clear" class="clear-btn hidden">Clear</button>
      </div>
      <ul id="tds-file-list" class="tds-file-list"></ul>

      <button type="button" id="tds-extract" class="conv-go-btn" disabled>Extract</button>
      <div id="tds-progress" class="pan-bulk-progress"></div>
      <div id="tds-errors"></div>
      <div id="tds-summary" class="tds-summary"></div>

      <div class="tds-actions hidden" id="tds-actions">
        <button type="button" id="tds-resolve-names" class="icon-btn is-recommended">Resolve Names (slow)</button>
        <button type="button" id="tds-export" class="icon-btn">Export Excel...</button>
      </div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#tds-details-toggle")!.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const details = root.querySelector<HTMLElement>("#tds-details")!;
    const showing = details.classList.toggle("hidden") === false;
    btn.textContent = showing ? "Hide details" : "Details...";
  });

  const pickBtn = root.querySelector<HTMLButtonElement>("#tds-pick-files")!;
  const fileCountEl = root.querySelector<HTMLElement>("#tds-file-count")!;
  const clearBtn = root.querySelector<HTMLButtonElement>("#tds-clear")!;
  const fileListEl = root.querySelector<HTMLElement>("#tds-file-list")!;
  const extractBtn = root.querySelector<HTMLButtonElement>("#tds-extract")!;
  const progressEl = root.querySelector<HTMLElement>("#tds-progress")!;
  const errorsEl = root.querySelector<HTMLElement>("#tds-errors")!;
  const summaryEl = root.querySelector<HTMLElement>("#tds-summary")!;
  const actionsEl = root.querySelector<HTMLElement>("#tds-actions")!;
  const resolveBtn = root.querySelector<HTMLButtonElement>("#tds-resolve-names")!;
  const exportBtn = root.querySelector<HTMLButtonElement>("#tds-export")!;

  let files: PickedFile[] = [];
  let metas: TdsFileMeta[] = [];
  let records: TdsRecord[] = [];

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
    const headingMap = new Map<string, { label: string; count: number; payment: number; tds: number }>();
    for (const r of records) {
      const entry = headingMap.get(r.headingCode) ?? { label: r.headingLabel, count: 0, payment: 0, tds: 0 };
      entry.count += 1;
      entry.payment += r.payment;
      entry.tds += r.tds;
      headingMap.set(r.headingCode, entry);
    }
    const rowsHtml = [...headingMap.entries()]
      .map(
        ([code, e]) => `
        <tr>
          <td>${code}</td>
          <td>${e.label}</td>
          <td>${e.count}</td>
          <td>${e.payment.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
          <td>${e.tds.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        </tr>`,
      )
      .join("");
    summaryEl.innerHTML = `
      <table class="pan-table tds-summary-table">
        <thead><tr><th>Code</th><th>Type</th><th>Count</th><th>Payment</th><th>TDS</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  pickBtn.addEventListener("click", async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "TDS Return", extensions: ["pdf", "aspx", "html", "htm"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    files = paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }));
    renderFileList();
    extractBtn.disabled = files.length === 0;
    actionsEl.classList.add("hidden");
    errorsEl.innerHTML = "";
    summaryEl.innerHTML = "";
    progressEl.textContent = "";
    progressEl.classList.remove("is-active", "is-done");
  });

  clearBtn.addEventListener("click", () => {
    files = [];
    metas = [];
    records = [];
    renderFileList();
    extractBtn.disabled = true;
    actionsEl.classList.add("hidden");
    errorsEl.innerHTML = "";
    summaryEl.innerHTML = "";
    progressEl.textContent = "";
    progressEl.classList.remove("is-active", "is-done");
  });

  extractBtn.addEventListener("click", async () => {
    extractBtn.disabled = true;
    records = [];
    metas = [];
    errorsEl.innerHTML = "";
    const errors: string[] = [];

    progressEl.classList.add("is-active");
    progressEl.classList.remove("is-done");
    for (let i = 0; i < files.length; i++) {
      progressEl.textContent = `Parsing ${i + 1}/${files.length}: ${files[i].name}...`;
      try {
        const bytes = await readFile(files[i].path);
        const { meta, records: recs } = await parseTdsFile(bytes, files[i].name);
        metas.push(meta);
        records.push(...recs);
      } catch (err) {
        errors.push(`${files[i].name}: ${(err as Error).message ?? String(err)}`);
      }
    }

    progressEl.classList.remove("is-active");
    progressEl.classList.add("is-done");
    progressEl.textContent = `Done. ${records.length} transaction(s) from ${files.length} file(s).${
      errors.length ? ` ${errors.length} file(s) failed.` : ""
    }`;
    if (errors.length) {
      errorsEl.innerHTML = `<div class="conv-error">${errors.join("<br>")}</div>`;
    }
    renderSummary();
    extractBtn.disabled = false;
    actionsEl.classList.toggle("hidden", records.length === 0);
  });

  resolveBtn.addEventListener("click", async () => {
    resolveBtn.disabled = true;
    const uniquePans = [...new Set(records.map((r) => r.pan))];
    let resolved = 0;
    progressEl.classList.add("is-active");
    progressEl.classList.remove("is-done");
    for (let i = 0; i < uniquePans.length; i++) {
      progressEl.textContent = `Resolving name ${i + 1}/${uniquePans.length}: ${uniquePans[i]}...`;
      const row = await searchOne(uniquePans[i]);
      const english = row["Name (English)"];
      const nepali = row["Name (Nepali)"];
      if (row.Status === "Found" && (english || nepali)) {
        for (const r of records) {
          if (r.pan !== uniquePans[i]) continue;
          if (english) r.nameEnglish = english;
          if (nepali) r.nameNepali = nepali; // replaces the garbled font-remapped extraction
        }
        resolved++;
      }
    }
    progressEl.classList.remove("is-active");
    progressEl.classList.add("is-done");
    progressEl.textContent = `Resolved ${resolved}/${uniquePans.length} unique PAN(s).`;
    renderSummary();
    resolveBtn.disabled = false;
  });

  exportBtn.addEventListener("click", async () => {
    const target = await save({
      defaultPath: "TDS_Extracted.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!target) return;
    const sheets = buildSheets(records, metas);
    await invoke("write_excel_multi", { path: target, sheets });
    progressEl.textContent = `Exported to ${target}`;
  });
}
