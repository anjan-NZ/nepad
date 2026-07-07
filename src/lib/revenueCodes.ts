import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { REVENUE_CODES } from "./revenueCodesData";
import { escapeHtml } from "./escapeHtml";

const IRD_REVENUE_CODES_URL = "https://ird.gov.np/content/5693/revenuecodes/";

function renderResults(listEl: HTMLElement, query: string, showAll: boolean): void {
  const q = query.trim().toLowerCase();
  const matches = q
    ? REVENUE_CODES.filter(
        (r) =>
          r.code.includes(q) ||
          r.oldCode.includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.titleNp.includes(q) ||
          r.explanation.toLowerCase().includes(q),
      )
    : [];

  if (!q && !showAll) {
    listEl.innerHTML = `<button type="button" id="rev-code-see-all" class="pan-sample-link">See all ${REVENUE_CODES.length} codes</button>`;
    return;
  }

  const rows = q ? matches : REVENUE_CODES;

  if (rows.length === 0) {
    listEl.innerHTML = `<p class="rev-code-empty">No matching revenue code.</p>`;
    return;
  }

  listEl.innerHTML = rows
    .map(
      (r) => `
        <div class="rev-code-item">
          <div class="rev-code-item-head">
            <span class="rev-code-badge">${escapeHtml(r.code)}</span>
            <span class="rev-code-title">${escapeHtml(r.title)}</span>
          </div>
          <p class="rev-code-title-np">${escapeHtml(r.titleNp)}</p>
          <p class="rev-code-explanation">${escapeHtml(r.explanation)}</p>
          ${r.oldCode ? `<p class="rev-code-old">Old code: ${escapeHtml(r.oldCode)}</p>` : ""}
        </div>
      `,
    )
    .join("");
}

export function renderRevenueCodes(root: HTMLElement): void {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">Revenue Codes (IRD Nepal)</h2>
      <button type="button" class="details-toggle" id="rev-code-details-toggle">Details...</button>
      <p class="pan-hint hidden" id="rev-code-details">
        Bundled from IRD's own Revenue Code list. Search by code number or by keyword in the
        English or Nepali title/explanation.
        <br />राजस्व संकेत नम्बर वा शीर्षकको शब्दबाट खोज्नुहोस्।
      </p>

      <div class="rev-code-links">
        <a href="#" id="rev-code-ird-link" class="pan-sample-link">Open IRD Revenue Codes page</a>
        <a href="#" id="rev-code-pdf-link" class="pan-sample-link">Download PDF</a>
      </div>

      <input
        id="rev-code-search"
        type="text"
        placeholder="Search by code or keyword..."
        autocomplete="off"
        class="rev-code-search-input"
      />
      <div id="rev-code-list" class="rev-code-list"></div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#rev-code-details-toggle")!.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const details = root.querySelector<HTMLElement>("#rev-code-details")!;
    const showing = details.classList.toggle("hidden") === false;
    btn.textContent = showing ? "Hide details" : "Details...";
  });

  root.querySelector<HTMLAnchorElement>("#rev-code-ird-link")!.addEventListener("click", async (e) => {
    e.preventDefault();
    await openUrl(IRD_REVENUE_CODES_URL);
  });

  root.querySelector<HTMLAnchorElement>("#rev-code-pdf-link")!.addEventListener("click", async (e) => {
    e.preventDefault();
    const destPath = await save({
      defaultPath: "Revenue Code.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!destPath) return;
    try {
      await invoke("download_revenue_code_pdf", { destPath });
    } catch (err) {
      console.error("[rev-code] download failed:", err);
      alert("Download failed: " + String(err));
    }
  });

  const searchInput = root.querySelector<HTMLInputElement>("#rev-code-search")!;
  const listEl = root.querySelector<HTMLElement>("#rev-code-list")!;
  let showAll = false;

  const rerender = () => {
    renderResults(listEl, searchInput.value, showAll);
    listEl.querySelector<HTMLButtonElement>("#rev-code-see-all")?.addEventListener("click", () => {
      showAll = true;
      rerender();
    });
  };

  rerender();
  searchInput.addEventListener("input", () => {
    showAll = false;
    rerender();
  });
}
