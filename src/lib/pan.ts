import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { escapeHtml } from "./escapeHtml";

const KNOWN_COLUMN_ORDER = [
  "PAN",
  "Name (English)",
  "Name (Nepali)",
  "Address",
  "Ward",
  "Office",
  "Registration Date",
  "Business Names",
];

const CONSUMED_FIELD_KEYS = new Set([
  "PAN",
  "Name (Eng)",
  "Name (English)",
  "Name (Nep)",
  "Name (Nepali)",
  "Address",
  "Ward",
  "Office",
  "Effective Registration Date",
  "Registration Date",
]);

export type PanRow = Record<string, string>;

function pick(fields: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    if (fields[n] !== undefined && fields[n] !== "") return fields[n];
  }
  return "";
}

function parsePanResponse(pan: string, raw: string): PanRow {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { PAN: pan, Status: "Error: invalid response from page" };
  }

  if (data?.__debug_error === "selector_missing") {
    return {
      PAN: pan,
      Status: `Error: page selectors not found (input=${data.hasInput}, button=${data.hasButton}). Page title: "${data.title}". Body starts: ${data.bodySnippet}`,
    };
  }
  if (data?.__debug_error) {
    return {
      PAN: pan,
      Status: `Error (${data.__debug_error}): ${data.message}`,
    };
  }

  if (data?.status === "Found") {
    const fields: Record<string, string> = data.fields ?? {};
    const business: Record<string, string>[] = data.business ?? [];
    const row: PanRow = {
      PAN: pick(fields, "PAN") || pan,
      "Name (English)": pick(fields, "Name (Eng)", "Name (English)"),
      "Name (Nepali)": pick(fields, "Name (Nep)", "Name (Nepali)"),
      Address: pick(fields, "Address"),
      Ward: pick(fields, "Ward"),
      Office: pick(fields, "Office"),
      "Registration Date": pick(
        fields,
        "Effective Registration Date",
        "Registration Date",
      ),
      "Business Names": business
        .map((b) => pick(b, "Trade Name (Eng)", "Trade Name", "Name"))
        .filter(Boolean)
        .join(" | "),
      Status: "Found",
    };

    for (const [key, value] of Object.entries(fields)) {
      if (CONSUMED_FIELD_KEYS.has(key) || !value) continue;
      const outKey = key === "Status" ? "Tax Clearance Status" : key;
      row[outKey] = value;
    }
    return row;
  }

  return { PAN: pan, Status: "Not Found" };
}

export async function searchOne(pan: string): Promise<PanRow> {
  try {
    const raw = await invoke<string>("pan_search_one", { pan });
    return parsePanResponse(pan, raw);
  } catch (err) {
    return { PAN: pan, Status: `Error: ${(err as Error).toString()}` };
  }
}

function clearanceSummary(row: PanRow): string {
  const fy = row["Fiscal Year"];
  const status = row["Tax Clearance Status"];
  const verified = row["Return Verified Date"];
  const parts: string[] = [];
  if (fy) parts.push(`Fiscal Year ${fy}`);
  if (status) parts.push(status);
  if (verified) parts.push(`Verified ${verified}`);
  return parts.join(" · ");
}

function buildTable(rows: PanRow[]): { headers: string[]; matrix: string[][] } {
  const seen = new Set<string>(["PAN", "Status"]);
  const headers: string[] = ["PAN"];
  for (const c of KNOWN_COLUMN_ORDER) {
    if (c !== "PAN") {
      headers.push(c);
      seen.add(c);
    }
  }
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  headers.push("Status");

  const matrix = rows.map((row) => headers.map((h) => row[h] ?? ""));
  return { headers, matrix };
}

function extractPansFromCsvText(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const pans: string[] = [];
  for (const line of lines) {
    const first = line.split(",")[0]?.trim().replace(/^"|"$/g, "");
    if (first && /^\d{9}$/.test(first)) pans.push(first);
  }
  return [...new Set(pans)];
}

async function extractPansFromFile(path: string): Promise<string[]> {
  if (/\.xlsx$/i.test(path)) {
    return invoke<string[]>("read_pans_from_excel", { path });
  }
  const text = await readTextFile(path);
  return extractPansFromCsvText(text);
}

export function renderPan(root: HTMLElement): void {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">PAN Lookup (IRD Nepal)</h2>
      <button type="button" class="details-toggle" id="pan-details-toggle">Details...</button>
      <p class="pan-hint hidden" id="pan-details">
        Drives the real IRD search page in a hidden window. Each lookup takes a few
        seconds. Only runs when you click Search/Run.
      </p>

      <div class="pan-single">
        <input id="pan-single-input" type="text" placeholder="9-digit PAN" maxlength="9" autocomplete="off" />
        <button type="button" id="pan-single-go" class="conv-go-btn">Search</button>
      </div>
      <div id="pan-single-result" class="pan-single-result"></div>

      <div class="pan-bulk">
        <div class="pan-bulk-row">
          <button type="button" id="pan-pick-file" class="icon-btn pan-pick-btn">Choose Excel...</button>
          <span id="pan-file-name" class="pan-file-name">No file chosen</span>
          <button type="button" id="pan-clear" class="clear-btn hidden">Clear</button>
        </div>
        <button type="button" id="pan-sample" class="pan-sample-link">Download sample Excel</button>
        <button type="button" id="pan-run-bulk" class="conv-go-btn" disabled>Run Bulk Lookup</button>
        <div id="pan-bulk-progress" class="pan-bulk-progress"></div>
        <div id="pan-bulk-table-wrap" class="pan-bulk-table-wrap"></div>
        <button type="button" id="pan-export" class="icon-btn pan-export-btn hidden">Export Excel...</button>
      </div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#pan-details-toggle")!.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const details = root.querySelector<HTMLElement>("#pan-details")!;
    const showing = details.classList.toggle("hidden") === false;
    btn.textContent = showing ? "Hide details" : "Details...";
  });

  const singleInput = root.querySelector<HTMLInputElement>("#pan-single-input")!;
  const singleGo = root.querySelector<HTMLButtonElement>("#pan-single-go")!;
  const singleResult = root.querySelector<HTMLElement>("#pan-single-result")!;

  const pickFileBtn = root.querySelector<HTMLButtonElement>("#pan-pick-file")!;
  const fileNameEl = root.querySelector<HTMLElement>("#pan-file-name")!;
  const sampleBtn = root.querySelector<HTMLButtonElement>("#pan-sample")!;
  const runBulkBtn = root.querySelector<HTMLButtonElement>("#pan-run-bulk")!;
  const progressEl = root.querySelector<HTMLElement>("#pan-bulk-progress")!;
  const tableWrap = root.querySelector<HTMLElement>("#pan-bulk-table-wrap")!;
  const exportBtn = root.querySelector<HTMLButtonElement>("#pan-export")!;
  const clearBtn = root.querySelector<HTMLButtonElement>("#pan-clear")!;

  let chosenFilePath: string | null = null;
  let bulkResults: PanRow[] = [];

  function renderRow(row: PanRow): string {
    return `
      <tr>
        <td>${escapeHtml(row.PAN ?? "")}</td>
        <td>${escapeHtml(row["Name (English)"] ?? "")}</td>
        <td>${escapeHtml(row.Status ?? "")}</td>
      </tr>
    `;
  }

  function renderTable() {
    if (bulkResults.length === 0) {
      tableWrap.innerHTML = "";
      return;
    }
    tableWrap.innerHTML = `
      <table class="pan-table">
        <thead><tr><th>PAN</th><th>Name</th><th>Status</th></tr></thead>
        <tbody>${bulkResults.map(renderRow).join("")}</tbody>
      </table>
    `;
  }

  singleGo.addEventListener("click", async () => {
    const pan = singleInput.value.trim();
    if (!/^\d{9}$/.test(pan)) {
      singleResult.innerHTML = `<div class="conv-error">Enter a 9-digit PAN</div>`;
      return;
    }
    singleGo.disabled = true;
    singleResult.innerHTML = `<div class="pan-loading">Searching...</div>`;
    const row = await searchOne(pan);
    singleGo.disabled = false;
    if (row.Status === "Found") {
      const clearance = clearanceSummary(row);
      singleResult.innerHTML = `
        <div class="conv-line">${escapeHtml(row["Name (English)"] ?? "")}</div>
        <div class="conv-weekday">${escapeHtml(row.Office ?? "")}</div>
        ${clearance ? `<div class="conv-weekday">${escapeHtml(clearance)}</div>` : ""}
      `;
    } else {
      singleResult.innerHTML = `<div class="conv-error">${escapeHtml(row.Status ?? "")}</div>`;
    }
  });

  sampleBtn.addEventListener("click", async () => {
    const target = await save({
      defaultPath: "sample_pans.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!target) return;
    await invoke("write_excel", {
      path: target,
      headers: ["PAN"],
      rows: [["100000001"], ["100000002"], ["100000003"]],
    });
  });

  pickFileBtn.addEventListener("click", async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Excel/CSV", extensions: ["xlsx", "csv"] }],
    });
    if (typeof picked === "string") {
      chosenFilePath = picked;
      fileNameEl.textContent = picked.split(/[\\/]/).pop() ?? picked;
      runBulkBtn.disabled = false;
      clearBtn.classList.remove("hidden");
    }
  });

  clearBtn.addEventListener("click", () => {
    chosenFilePath = null;
    bulkResults = [];
    fileNameEl.textContent = "No file chosen";
    runBulkBtn.disabled = true;
    progressEl.textContent = "";
    progressEl.classList.remove("is-active", "is-done");
    exportBtn.classList.add("hidden");
    clearBtn.classList.add("hidden");
    renderTable();
  });

  runBulkBtn.addEventListener("click", async () => {
    if (!chosenFilePath) return;
    runBulkBtn.disabled = true;
    bulkResults = [];
    renderTable();
    exportBtn.classList.add("hidden");

    let pans: string[];
    try {
      pans = await extractPansFromFile(chosenFilePath);
    } catch (err) {
      progressEl.innerHTML = `<div class="conv-error">Could not read file: ${(err as Error).toString()}</div>`;
      runBulkBtn.disabled = false;
      return;
    }

    if (pans.length === 0) {
      progressEl.innerHTML = `<div class="conv-error">No valid 9-digit PAN numbers found in that file</div>`;
      runBulkBtn.disabled = false;
      return;
    }

    progressEl.classList.add("is-active");
    progressEl.classList.remove("is-done");
    for (let i = 0; i < pans.length; i++) {
      progressEl.textContent = `Looking up ${i + 1}/${pans.length}: ${pans[i]}...`;
      const row = await searchOne(pans[i]);
      bulkResults.push(row);
      renderTable();
    }

    progressEl.classList.remove("is-active");
    progressEl.classList.add("is-done");
    progressEl.textContent = `Done. ${bulkResults.length} looked up.`;
    runBulkBtn.disabled = false;
    exportBtn.classList.remove("hidden");
  });

  exportBtn.addEventListener("click", async () => {
    const target = await save({
      defaultPath: "pan_results.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!target) return;
    const { headers, matrix } = buildTable(bulkResults);
    await invoke("write_excel", { path: target, headers, rows: matrix });
  });
}
