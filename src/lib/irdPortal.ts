import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { escapeHtml } from "./escapeHtml";
import { searchOne } from "./pan";

interface TdsRow {
  tranNo: string;
  status: string;
  statusText: string;
}

interface VatRow {
  submissionNo: string;
  taxYear: string;
  filingPeriod: string;
  period: string;
  submissionDate: string;
}

interface ListRow {
  id: string;
  cols: string[];
  item: Record<string, string>;
}

type IrdKind = "tds" | "vat" | "vouchers" | "annex";

interface ExportResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface DlResult {
  tranNo: string;
  ok: boolean;
  detail: string;
}

interface Progress {
  done: number;
  total: number;
}

const POLL_MS = 3000;

const MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];

function friendlyError(detail: string): string {
  if (detail.startsWith("skipped")) return "Skipped (earlier ones failed)";
  if (detail.includes("Oopspage")) return "Portal refused this return";
  if (detail.includes("not a PDF")) return "Portal did not return a PDF";
  if (detail.includes("curl.exe not found")) return "curl.exe missing";
  return "Failed (hover for details)";
}

export function renderIrdPortal(root: HTMLElement): void {
  root.innerHTML = `
    <section class="card" id="ird-card">
      <h2 class="card-title">IRD Return Downloader</h2>
      <p class="pan-hint">Opens the IRD taxpayer portal in its own window. Log in yourself (captcha included). Once you are logged in, the download options appear here.</p>
      <button type="button" class="conv-go-btn" id="ird-open">Open IRD Portal</button>
      <p class="pan-hint" id="ird-status"></p>
      <p class="pan-hint hidden" id="ird-err"></p>

      <div id="ird-panel" class="ird-reveal">
       <div class="ird-reveal-inner">
        <div class="conv-inputs ird-inputs">
          <select id="ird-type" title="Return type">
            <option value="tds">TDS</option>
            <option value="vat">VAT</option>
            <option value="vouchers">Paid Voucher List</option>
            <option value="annex">Annex 10 vouchers</option>
          </select>
          <input type="text" id="ird-pan" placeholder="PAN" maxlength="9" autocomplete="off" />
        </div>
        <p class="pan-hint ird-name" id="ird-name"></p>
        <p class="pan-hint" id="ird-hint"></p>
        <div class="conv-inputs ird-inputs">
          <select id="ird-fy" title="Fiscal year (Shrawan to Ashadh)"></select>
          <select id="ird-fy-to" title="Last fiscal year, to cover several years (optional)"></select>
        </div>
        <div class="conv-inputs ird-inputs">
          <input type="text" id="ird-from" autocomplete="off" />
          <input type="text" id="ird-to" autocomplete="off" />
        </div>
        <div class="tds-pick-row ird-actions">
          <button type="button" class="icon-btn pan-pick-btn" id="ird-search">Search list</button>
          <button type="button" class="icon-btn pan-pick-btn" id="ird-all" disabled>Select all / none</button>
        </div>
        <button type="button" class="conv-go-btn" id="ird-go" disabled>Download selected</button>
        <div id="ird-list"></div>
        <p class="pan-hint" id="ird-msg"></p>
        <p class="pan-hint" id="ird-dir"></p>
        <div class="tds-pick-row ird-actions">
          <button type="button" class="icon-btn pan-pick-btn" id="ird-clear" title="Empty the PAN, dates and list">Clear</button>
          <button type="button" class="icon-btn pan-pick-btn" id="ird-logout" title="End the portal session and close its window">Log out</button>
        </div>
       </div>
      </div>
    </section>
  `;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const openBtn = $<HTMLButtonElement>("ird-open");
  const statusEl = $("ird-status");
  const errEl = $("ird-err");
  const panel = $("ird-panel");
  const panInput = $<HTMLInputElement>("ird-pan");
  const searchBtn = $<HTMLButtonElement>("ird-search");
  const allBtn = $<HTMLButtonElement>("ird-all");
  const goBtn = $<HTMLButtonElement>("ird-go");
  const listEl = $("ird-list");
  const msgEl = $("ird-msg");

  const ua = navigator.userAgent;
  let rows: ListRow[] = [];
  const typeSel = $<HTMLSelectElement>("ird-type");
  const fromInput = $<HTMLInputElement>("ird-from");
  const toInput = $<HTMLInputElement>("ird-to");
  const card = $("ird-card");
  let timer: number | undefined;
  let wasReady = false;
  let busy = false;
  let panEdited = false;
  let listedPan = "";
  let panTimer: number | undefined;

  try {
    localStorage.removeItem("ird_pan");
  } catch {
  }

  const showError = (el: HTMLElement, text: string) => {
    el.textContent = text;
    el.classList.remove("hidden");
  };

  async function checkSession() {
    if (!root.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (busy) return;
    let ready = false;
    try {
      ready = await invoke<boolean>("ird_session_ready", { ua });
    } catch {
    }
    panel.classList.toggle("is-open", ready);
    if (ready && !wasReady) {
      openBtn.textContent = "Show IRD Portal";
      card.classList.remove("ird-flash");
      void card.offsetWidth;
      card.classList.add("ird-flash");
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    wasReady = ready;
    if (ready) window.clearInterval(timer);
    if (!busy) {
      statusEl.classList.toggle("ird-status-ok", ready);
      statusEl.textContent = ready ? "Logged in" : "Waiting for login in the portal window...";
    }
  }

  const openPortal = async () => {
    errEl.classList.add("hidden");
    try {
      await invoke("ird_open_portal");
      if (wasReady) return;
      window.clearInterval(timer);
      void checkSession();
      timer = window.setInterval(() => void checkSession(), POLL_MS);
      watchPan();
    } catch (e) {
      showError(errEl, `Could not open portal: ${e}`);
    }
  };
  openBtn.addEventListener("click", () => void openPortal());

  invoke<string>("ird_downloads_dir").then((d) => {
    $("ird-dir").textContent = `Saves to: ${d}`;
  });

  void listen<Progress>("ird-progress", (e) => {
    msgEl.textContent = `Downloading ${Math.min(e.payload.done + 1, e.payload.total)} / ${e.payload.total}...`;
  });

  const hintEl = $("ird-hint");
  const nameEl = $("ird-name");
  const names = new Map<string, string>();

  async function showName(pan: string) {
    nameEl.textContent = "";
    if (!/^\d{9,10}$/.test(pan)) return;
    let name = names.get(pan);
    if (name === undefined) {
      nameEl.textContent = "Looking up name...";
      const row = await searchOne(pan);
      name = row["Name (English)"] || row["Name (Nepali)"] || "";
      if (name) names.set(pan, name);
      if (!name && row.Status?.startsWith("Error")) {
        if (panInput.value.trim() === pan) nameEl.textContent = "Name lookup failed";
        return;
      }
    }
    if (panInput.value.trim() === pan) nameEl.textContent = name || "Name not found";
  }
  panInput.addEventListener("input", () => {
    nameEl.textContent = "";
    panEdited = true;
  });

  async function capturePan(ready: boolean): Promise<string> {
    if (panEdited) return "";
    let pan = "";
    try {
      pan = await invoke<string>("ird_portal_pan");
    } catch {
      return "";
    }
    if (!pan || panEdited) return "";
    if (pan !== panInput.value.trim()) {
      panInput.value = pan;
      nameEl.textContent = "";
    }
    if (ready && !nameEl.textContent) void showName(pan);
    return pan;
  }

  function watchPan() {
    window.clearInterval(panTimer);
    let tries = 0;
    panTimer = window.setInterval(async () => {
      if (!root.isConnected || panEdited || ++tries > 60) {
        window.clearInterval(panTimer);
        return;
      }
      const found = await capturePan(wasReady);
      if (found && wasReady) window.clearInterval(panTimer);
    }, 3000);
  }
  const fySel = $<HTMLSelectElement>("ird-fy");
  const fyToSel = $<HTMLSelectElement>("ird-fy-to");
  const kind = (): IrdKind => (["vat", "vouchers", "annex"].includes(typeSel.value) ? (typeSel.value as IrdKind) : "tds");
  const isExport = () => kind() === "vouchers" || kind() === "annex";

  const now = new Date();
  const bsYear = now.getFullYear() + ((now.getMonth() === 3 && now.getDate() >= 14) || now.getMonth() > 3 ? 57 : 56);
  const fyOptions = (blank: string) =>
    `<option value="">${blank}</option>` +
    Array.from({ length: bsYear - 2074 + 1 }, (_, i) => bsYear - i)
      .map((y) => `<option value="${y}">${y}/${String(y + 1).slice(2)}</option>`)
      .join("");
  fySel.innerHTML = fyOptions("Fiscal year");
  fyToSel.innerHTML = fyOptions("To FY (optional)");

  function applyFy() {
    const a = Number(fySel.value) || Number(fyToSel.value);
    if (!a) return;
    const b = Number(fyToSel.value) || a;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (kind() === "vat") {
      fromInput.value = `${lo}.04`;
      toInput.value = `${hi + 1}.03`;
    } else {
      fromInput.value = `${lo}.04.01`;
      toInput.value = `${hi + 1}.03.32`;
    }
  }
  fySel.addEventListener("change", applyFy);
  fyToSel.addEventListener("change", applyFy);
  [fromInput, toInput].forEach((el) =>
    el.addEventListener("input", () => {
      fySel.value = fyToSel.value = "";
    }),
  );

  function applyType() {
    const vat = kind() === "vat";
    const exp = isExport();
    hintEl.textContent = kind() === "annex"
      ? "Enter the PAN and pick a fiscal year (or two for a span). Each year is saved as its own Excel file."
      : kind() === "vouchers"
        ? "Enter the PAN and pick a fiscal year (or two for a span), or type a Nepali date range. Saved as one Excel file."
        : vat
      ? "Enter the PAN. The portal lists every VAT return for it; pick a fiscal year (or two for a span), or type a month range like 2081.04 to 2082.03."
      : "Enter the PAN and pick a fiscal year (or two for a span), or type a Nepali date range.";
    fromInput.placeholder = vat ? "From month (optional)" : "From (BS)";
    toInput.placeholder = vat ? "To month (optional)" : "To (BS)";
    fromInput.title = vat ? "First month, e.g. 2081.04 (blank = earliest)" : "From date, e.g. 2081.04.01";
    toInput.title = vat ? "Last month, e.g. 2082.03 (blank = latest)" : "To date, e.g. 2082.03.32";
    fromInput.maxLength = toInput.maxLength = vat ? 7 : 10;
    fromInput.value = toInput.value = "";
    fySel.value = fyToSel.value = "";
    rows = [];
    listEl.innerHTML = "";
    msgEl.textContent = "";
    allBtn.disabled = true;
    goBtn.disabled = !exp;
    goBtn.textContent = exp ? "Export to Excel" : "Download selected";
    searchBtn.hidden = allBtn.hidden = exp;
    fromInput.hidden = toInput.hidden = kind() === "annex";
  }
  typeSel.addEventListener("change", applyType);
  applyType();

  const lockable = [typeSel, fySel, fyToSel, $<HTMLButtonElement>("ird-clear"), $<HTMLButtonElement>("ird-logout"), searchBtn, allBtn];
  function setLocked(on: boolean) {
    lockable.forEach((el) => (el.disabled = on));
    if (!on) allBtn.disabled = rows.length === 0;
  }

  function clearForm() {
    applyType();
    panInput.value = "";
    nameEl.textContent = "";
    panEdited = false;
  }
  $("ird-clear").addEventListener("click", clearForm);
  $("ird-logout").addEventListener("click", async () => {
    if (busy) return;
    try {
      await invoke("ird_logout");
    } catch (e) {
      msgEl.textContent = `Could not log out: ${e}`;
      return;
    }
    window.clearInterval(timer);
    window.clearInterval(panTimer);
    clearForm();
    panel.classList.remove("is-open");
    wasReady = false;
    openBtn.textContent = "Open IRD Portal";
    statusEl.classList.remove("ird-status-ok");
    statusEl.textContent = "Logged out";
  });

  const picked = () =>
    Array.from(listEl.querySelectorAll<HTMLInputElement>("input:checked")).map((c) => rows[Number(c.dataset.i)]);

  const monthKey = (v: string) => {
    const m = /^(\d{4})\.(0?[1-9]|1[0-2])$/.exec(v);
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : NaN;
  };

  function tdsFy(): string {
    const m = /^(\d{4})\.(\d{1,2})/.exec(fromInput.value.trim());
    const y = Number(fySel.value) || Number(fyToSel.value) || (m ? Number(m[1]) - (Number(m[2]) < 4 ? 1 : 0) : 0);
    const lo = Math.min(Number(fySel.value) || Infinity, Number(fyToSel.value) || Infinity);
    const start = Number.isFinite(lo) ? lo : y;
    return start ? `${start}-${String((start + 1) % 100).padStart(2, "0")}` : "";
  }

  async function fetchRows(pan: string): Promise<ListRow[]> {
    const from = fromInput.value.trim();
    const to = toInput.value.trim();
    if (kind() === "vat") {
      const lo = from ? monthKey(from) : -Infinity;
      const hi = to ? monthKey(to) : Infinity;
      if (Number.isNaN(lo) || Number.isNaN(hi)) throw new Error("Months must look like 2081.04.");
      const all = await invoke<VatRow[]>("ird_list_vat", { pan, ua });
      const key = (r: VatRow) => Number(r.taxYear) * 12 + Number(r.period) - 1;
      return all
        .filter((r) => r.filingPeriod !== "M" || Number.isNaN(key(r)) || (key(r) >= lo && key(r) <= hi))
        .sort((a, b) => key(a) - key(b))
        .map((r) => ({
          id: r.submissionNo,
          cols: [
            r.filingPeriod === "M" ? `${MONTHS[Number(r.period) - 1] ?? r.period} ${r.taxYear}` : `${r.filingPeriod}${r.period} ${r.taxYear}`,
            r.submissionDate,
            r.submissionNo,
          ],
          item: { submissionNo: r.submissionNo, taxYear: r.taxYear, filingPeriod: r.filingPeriod, period: r.period },
        }));
    }
    if (!from || !to) throw new Error("Enter the from and to dates.");
    const all = await invoke<TdsRow[]>("ird_list_tds", { pan, from, to, ua });
    return all.map((r) => ({
      id: r.tranNo,
      cols: [r.tranNo, r.statusText || r.status],
      item: { tranNo: r.tranNo, status: r.status },
    }));
  }

  searchBtn.addEventListener("click", async () => {
    const pan = panInput.value.trim();
    if (!pan) {
      msgEl.textContent = "Enter the PAN first.";
      return;
    }
    msgEl.textContent = "Searching...";
    void showName(pan);
    try {
      rows = await fetchRows(pan);
      listedPan = pan;
      listEl.innerHTML = rows.length
        ? `<table class="pan-table"><tbody>${rows
            .map(
              (r, i) => `<tr>
                <td><input type="checkbox" data-i="${i}" checked /></td>
                <td>${i + 1}</td>
                ${r.cols.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}
                <td data-tran="${escapeHtml(r.id)}"></td>
              </tr>`,
            )
            .join("")}</tbody></table>`
        : "";
      msgEl.textContent = `${rows.length} record(s) found`;
      goBtn.disabled = allBtn.disabled = rows.length === 0;
    } catch (e) {
      msgEl.textContent = e instanceof Error ? e.message : String(e);
    }
  });

  allBtn.addEventListener("click", () => {
    const boxes = Array.from(listEl.querySelectorAll<HTMLInputElement>("input"));
    const anyOff = boxes.some((b) => !b.checked);
    boxes.forEach((b) => (b.checked = anyOff));
  });

  async function exportExcel() {
    const pan = panInput.value.trim();
    if (!pan) {
      msgEl.textContent = "Enter the PAN first.";
      return;
    }
    const a = Number(fySel.value) || Number(fyToSel.value);
    const b = Number(fyToSel.value) || a;
    goBtn.disabled = true;
    busy = true;
    setLocked(true);
    try {
      if (!names.get(pan)) await showName(pan);
      const company = names.get(pan) ?? "";
      let res: ExportResult[];
      if (kind() === "annex") {
        if (!a) throw new Error("Pick a fiscal year.");
        const years = Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i);
        msgEl.textContent = "Exporting...";
        res = await invoke<ExportResult[]>("ird_export_annex10", { pan, years, ua, company });
      } else {
        const from = fromInput.value.trim();
        const to = toInput.value.trim();
        if (!from || !to) throw new Error("Pick a fiscal year or enter the from and to dates.");
        msgEl.textContent = "Exporting...";
        res = [await invoke<ExportResult>("ird_export_vouchers", { pan, from, to, ua, company, fy: tdsFy() })];
      }
      listEl.innerHTML = `<table class="pan-table"><tbody>${res
        .map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.ok ? "Saved, " + r.detail : r.detail)}</td></tr>`)
        .join("")}</tbody></table>`;
      const ok = res.filter((r) => r.ok).length;
      msgEl.textContent = `Done: ${ok} saved` + (ok < res.length ? `, ${res.length - ok} failed` : "");
    } catch (e) {
      msgEl.textContent = e instanceof Error ? e.message : String(e);
    }
    busy = false;
    setLocked(false);
    goBtn.disabled = false;
  }

  goBtn.addEventListener("click", async () => {
    if (isExport()) return void exportExcel();
    const items = picked().map((r) => r.item);
    if (items.length === 0) return;
    goBtn.disabled = true;
    busy = true;
    setLocked(true);
    try {
      if (!names.get(listedPan)) await showName(listedPan);
      const company = names.get(listedPan) ?? "";
      const res =
        kind() === "vat"
          ? await invoke<DlResult[]>("ird_download_vat", { pan: listedPan, items, ua, company })
          : await invoke<DlResult[]>("ird_download_tds", { pan: listedPan, items, ua, company, fy: tdsFy() });
      res.forEach((r) => {
        const cell = listEl.querySelector<HTMLElement>(`td[data-tran="${CSS.escape(r.tranNo)}"]`);
        if (cell) {
          cell.textContent = r.ok ? "Saved" : friendlyError(r.detail);
          cell.title = r.ok ? "" : r.detail;
        }
      });
      const ok = res.filter((r) => r.ok).length;
      msgEl.textContent = `Done: ${ok} saved` + (ok < res.length ? `, ${res.length - ok} failed` : "");
    } catch (e) {
      msgEl.textContent = String(e);
    }
    busy = false;
    setLocked(false);
    goBtn.disabled = false;
  });
}
