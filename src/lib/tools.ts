import { renderTimer } from "./timer";
import { renderConverter } from "./converter";
import { renderPan } from "./pan";
import { renderTdsExtractor } from "./tdsExtractor";
import { renderVatExtractor } from "./vatExtractor";
import { renderRevenueCodes } from "./revenueCodes";
import { renderIrdPortal } from "./irdPortal";
import { getSettings, setSetting } from "./store";
import { enableDragReorder } from "./dragReorder";

interface ToolDef {
  title: string;
  short: string;
  icon: string;
  render: (root: HTMLElement) => void;
}

const TOOLS: Record<string, ToolDef> = {
  timer: {
    title: "Timer",
    short: "Timer",
    icon: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2M10 3h4"/>',
    render: renderTimer,
  },
  converter: {
    title: "Date Converter",
    short: "Date",
    icon: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    render: renderConverter,
  },
  pan: {
    title: "PAN Lookup",
    short: "PAN",
    icon: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    render: renderPan,
  },
  tds: {
    title: "TDS Return Extractor",
    short: "TDS",
    icon: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 13h5M10 17h5"/>',
    render: renderTdsExtractor,
  },
  vat: {
    title: "VAT Return Extractor",
    short: "VAT",
    icon: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12l2 5 2-5"/>',
    render: renderVatExtractor,
  },
  revenueCodes: {
    title: "Revenue Codes",
    short: "Codes",
    icon: '<path d="M5 6h14M5 12h14M5 18h9"/>',
    render: renderRevenueCodes,
  },
  irdTds: {
    title: "IRD Return Downloader",
    short: "IRD",
    icon: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/>',
    render: renderIrdPortal,
  },
};

const ALL_TOOL_IDS = Object.keys(TOOLS);

let arranging = false;

export async function renderTools(root: HTMLElement): Promise<void> {
  const settings = await getSettings();

  const order = settings.toolsOrder.filter((id) => ALL_TOOL_IDS.includes(id));
  for (const id of ALL_TOOL_IDS) if (!order.includes(id)) order.push(id);
  const hidden = new Set(settings.toolsHidden.filter((id) => ALL_TOOL_IDS.includes(id)));
  const hiddenIds = order.filter((id) => hidden.has(id));
  const visible = order.filter((id) => !hidden.has(id));
  const closed = new Set((settings.toolsClosed ?? []).filter((id) => ALL_TOOL_IDS.includes(id)));

  const kept = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>(".tool-open-body").forEach((body) => {
    if (body.dataset.id) kept.set(body.dataset.id, body);
  });

  root.innerHTML = "";

  if (arranging) {
    renderArrange(root, settings.toolsHidden, visible, hiddenIds);
    const parked = document.createElement("div");
    parked.className = "tools-parked";
    parked.append(...kept.values());
    root.append(parked);
    return;
  }

  const top = document.createElement("div");
  top.className = "tools-top";
  top.innerHTML = `
    <div class="tools-search"><input type="text" id="tools-search-input" placeholder="Search tools..." autocomplete="off" /></div>
    <button type="button" class="tools-arrange-btn" title="Reorder or hide tools">Arrange</button>
  `;
  const chips = document.createElement("div");
  chips.className = "tool-chips";
  const note = document.createElement("div");
  note.className = "tools-note hidden";
  const openArea = document.createElement("div");
  openArea.className = "tools-open";
  root.append(top, chips, note, openArea);

  const searchInput = top.querySelector<HTMLInputElement>("#tools-search-input")!;
  const query = () => searchInput.value.trim().toLowerCase();
  const matches = (id: string) => {
    const q = query();
    return (
      q === "" ||
      TOOLS[id].title.toLowerCase().includes(q) ||
      TOOLS[id].short.toLowerCase().includes(q)
    );
  };
  const isOpen = (id: string) => !closed.has(id);
  const wrapOf = (id: string) =>
    openArea.querySelector<HTMLElement>(`.tool-open[data-id="${id}"]`);
  const saveClosed = () => void setSetting("toolsClosed", [...closed]);

  function sync() {
    let shown = 0;
    chips.querySelectorAll<HTMLElement>(".tool-chip").forEach((chip) => {
      const id = chip.dataset.id!;
      const match = matches(id);
      chip.classList.toggle("hidden", !match);
      chip.classList.toggle("on", isOpen(id));
      chip.setAttribute("aria-pressed", String(isOpen(id)));
      if (match) shown++;
    });
    openArea.querySelectorAll<HTMLElement>(".tool-open").forEach((wrap) => {
      wrap.classList.toggle("hidden", !matches(wrap.dataset.id!));
    });
    let text = "";
    if (visible.length === 0) text = "All tools are hidden. Click Arrange to bring them back.";
    else if (shown === 0) text = "No tool matches.";
    else if (query() === "" && visible.every((id) => !isOpen(id)))
      text = "All tools are closed. Click a tool above to open it.";
    note.textContent = text;
    note.classList.toggle("hidden", text === "");
  }

  function mountTool(id: string) {
    const wrap = document.createElement("div");
    wrap.className = "tool-open";
    wrap.dataset.id = id;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tool-close";
    close.textContent = "×";
    close.title = `Close ${TOOLS[id].title}`;
    close.setAttribute("aria-label", `Close ${TOOLS[id].title}`);
    const reused = kept.get(id);
    kept.delete(id);
    const body = reused ?? document.createElement("div");
    body.className = "tool-open-body";
    body.dataset.id = id;
    wrap.append(close, body);

    const after = visible.slice(visible.indexOf(id) + 1).find((o) => wrapOf(o));
    if (after) openArea.insertBefore(wrap, wrapOf(after));
    else openArea.append(wrap);

    if (!reused) TOOLS[id].render(body);
    close.addEventListener("click", () => {
      closed.add(id);
      saveClosed();
      wrap.remove();
      sync();
    });
  }

  function showTool(id: string) {
    if (!isOpen(id)) {
      closed.delete(id);
      saveClosed();
      mountTool(id);
      sync();
    }
    wrapOf(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  for (const id of visible) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tool-chip";
    chip.dataset.id = id;
    chip.title = TOOLS[id].title;
    chip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TOOLS[id].icon}</svg><span>${TOOLS[id].short}</span>`;
    chip.addEventListener("click", () => showTool(id));
    chips.append(chip);
  }

  for (const id of visible) if (isOpen(id)) mountTool(id);
  sync();

  searchInput.addEventListener("input", sync);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const first = visible.find(matches);
    if (first) showTool(first);
  });

  top.querySelector<HTMLButtonElement>(".tools-arrange-btn")!.addEventListener("click", () => {
    arranging = true;
    void renderTools(root);
  });
}

function renderArrange(
  root: HTMLElement,
  toolsHidden: string[],
  visible: string[],
  hiddenIds: string[],
): void {
  const bar = document.createElement("div");
  bar.className = "tools-top";
  bar.innerHTML = `
    <div class="tools-arrange-title">Drag to reorder, &times; to hide</div>
    <button type="button" class="tools-arrange-btn">Done</button>
  `;
  root.append(bar);
  bar.querySelector<HTMLButtonElement>(".tools-arrange-btn")!.addEventListener("click", () => {
    arranging = false;
    void renderTools(root);
  });

  if (hiddenIds.length > 0) {
    const tray = document.createElement("div");
    tray.className = "tools-hidden-tray";
    tray.innerHTML = hiddenIds
      .map(
        (id) =>
          `<button type="button" class="tool-restore-btn" data-id="${id}">+ ${TOOLS[id].title}</button>`,
      )
      .join("");
    root.append(tray);
    tray.querySelectorAll<HTMLButtonElement>(".tool-restore-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id!;
        await setSetting(
          "toolsHidden",
          toolsHidden.filter((h) => h !== id),
        );
        void renderTools(root);
      });
    });
  }

  const list = document.createElement("div");
  list.className = "tools-list";
  root.append(list);

  for (const id of visible) {
    const shell = document.createElement("div");
    shell.className = "tool-shell tool-arrange-row";
    shell.dataset.id = id;
    shell.innerHTML = `
      <span class="tool-drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
      <span class="tool-arrange-name">${TOOLS[id].title}</span>
      <button type="button" class="tool-hide-btn" title="Hide ${TOOLS[id].title}" aria-label="Hide ${TOOLS[id].title}">&times;</button>
    `;
    list.append(shell);
    shell
      .querySelector<HTMLButtonElement>(".tool-hide-btn")!
      .addEventListener("click", async () => {
        await setSetting("toolsHidden", [...toolsHidden, id]);
        void renderTools(root);
      });
  }

  enableDragReorder(
    list,
    ".tool-shell",
    (el) => el.dataset.id!,
    (orderedVisibleIds) => {
      void setSetting("toolsOrder", [...orderedVisibleIds, ...hiddenIds]);
    },
    { handleSelector: ".tool-drag-handle" },
  );
}
