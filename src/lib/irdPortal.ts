import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { escapeHtml } from "./escapeHtml";

interface TdsRow {
  tranNo: string;
  status: string;
  statusText: string;
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
      <h2 class="card-title">IRD TDS Downloader</h2>
      <p class="pan-hint">Opens the IRD taxpayer portal in its own window. Log in yourself (captcha included). Once you are logged in, the download options appear here.</p>
      <button type="button" class="conv-go-btn" id="ird-open">Open IRD Portal</button>
      <p class="pan-hint" id="ird-status"></p>
      <p class="pan-hint hidden" id="ird-err"></p>

      <div id="ird-panel" class="ird-reveal">
       <div class="ird-reveal-inner">
        <p class="pan-hint">Enter the PAN and the Nepali date range.</p>
        <div class="conv-inputs ird-inputs">
          <input type="text" id="ird-pan" placeholder="PAN" maxlength="9" />
          <input type="text" id="ird-from" placeholder="From (BS)" title="From date, e.g. 2081.04.01" />
          <input type="text" id="ird-to" placeholder="To (BS)" title="To date, e.g. 2082.03.32" />
        </div>
        <div class="tds-pick-row ird-actions">
          <button type="button" class="icon-btn pan-pick-btn" id="ird-search">Search list</button>
          <button type="button" class="icon-btn pan-pick-btn" id="ird-all" disabled>Select all / none</button>
        </div>
        <button type="button" class="conv-go-btn" id="ird-go" disabled>Download selected</button>
        <div id="ird-list"></div>
        <p class="pan-hint" id="ird-msg"></p>
        <p class="pan-hint" id="ird-dir"></p>
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
  let rows: TdsRow[] = [];
  const card = $("ird-card");
  let timer: number | undefined;
  let wasReady = false;
  let busy = false;

  try {
    panInput.value = localStorage.getItem("ird_pan") ?? "";
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

  openBtn.addEventListener("click", async () => {
    errEl.classList.add("hidden");
    try {
      await invoke("ird_open_portal");
      window.clearInterval(timer);
      void checkSession();
      timer = window.setInterval(() => void checkSession(), POLL_MS);
    } catch (e) {
      showError(errEl, `Could not open portal: ${e}`);
    }
  });

  invoke<string>("ird_downloads_dir").then((d) => {
    $("ird-dir").textContent = `Saves to: ${d}`;
  });

  void listen<Progress>("ird-progress", (e) => {
    msgEl.textContent = `Downloading ${Math.min(e.payload.done + 1, e.payload.total)} / ${e.payload.total}...`;
  });

  const picked = () =>
    Array.from(listEl.querySelectorAll<HTMLInputElement>("input:checked")).map((c) => rows[Number(c.dataset.i)]);

  searchBtn.addEventListener("click", async () => {
    const pan = panInput.value.trim();
    if (!pan) {
      msgEl.textContent = "Enter the PAN first.";
      return;
    }
    if (!$<HTMLInputElement>("ird-from").value.trim() || !$<HTMLInputElement>("ird-to").value.trim()) {
      msgEl.textContent = "Enter the from and to dates.";
      return;
    }
    msgEl.textContent = "Searching...";
    try {
      rows = await invoke<TdsRow[]>("ird_list_tds", {
        pan,
        from: $<HTMLInputElement>("ird-from").value.trim(),
        to: $<HTMLInputElement>("ird-to").value.trim(),
        ua,
      });
      try {
        localStorage.setItem("ird_pan", pan);
      } catch {

      }
      listEl.innerHTML = rows.length
        ? `<table class="pan-table"><tbody>${rows
            .map(
              (r, i) => `<tr>
                <td><input type="checkbox" data-i="${i}" checked /></td>
                <td>${i + 1}</td>
                <td>${escapeHtml(r.tranNo)}</td>
                <td>${escapeHtml(r.statusText || r.status)}</td>
                <td data-tran="${escapeHtml(r.tranNo)}"></td>
              </tr>`,
            )
            .join("")}</tbody></table>`
        : "";
      msgEl.textContent = `${rows.length} record(s) found`;
      goBtn.disabled = allBtn.disabled = rows.length === 0;
    } catch (e) {
      msgEl.textContent = String(e);
    }
  });

  allBtn.addEventListener("click", () => {
    const boxes = Array.from(listEl.querySelectorAll<HTMLInputElement>("input"));
    const anyOff = boxes.some((b) => !b.checked);
    boxes.forEach((b) => (b.checked = anyOff));
  });

  goBtn.addEventListener("click", async () => {
    const items = picked().map((r) => ({ tranNo: r.tranNo, status: r.status }));
    if (items.length === 0) return;
    goBtn.disabled = true;
    busy = true;
    try {
      const res = await invoke<DlResult[]>("ird_download_tds", { pan: panInput.value.trim(), items, ua });
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
    goBtn.disabled = false;
  });
}
