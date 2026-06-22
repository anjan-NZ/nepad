import { renderTimer } from "./timer";
import { renderConverter } from "./converter";
import { renderPan } from "./pan";
import { renderTdsExtractor } from "./tdsExtractor";
import { renderVatExtractor } from "./vatExtractor";
import { getSettings, setSetting } from "./store";
import { enableDragReorder } from "./dragReorder";

interface ToolDef {
  title: string;
  render: (root: HTMLElement) => void;
}

const TOOLS: Record<string, ToolDef> = {
  timer: { title: "Timer", render: renderTimer },
  converter: { title: "Date Converter", render: renderConverter },
  pan: { title: "PAN Lookup", render: renderPan },
  tds: { title: "TDS Return Extractor", render: renderTdsExtractor },
  vat: { title: "VAT Return Extractor", render: renderVatExtractor },
};

const ALL_TOOL_IDS = Object.keys(TOOLS);

export async function renderTools(root: HTMLElement): Promise<void> {
  const settings = await getSettings();

  const order = settings.toolsOrder.filter((id) => ALL_TOOL_IDS.includes(id));
  for (const id of ALL_TOOL_IDS) if (!order.includes(id)) order.push(id);
  const hidden = new Set(settings.toolsHidden.filter((id) => ALL_TOOL_IDS.includes(id)));

  root.innerHTML = "";

  const hiddenIds = order.filter((id) => hidden.has(id));
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
          settings.toolsHidden.filter((h) => h !== id),
        );
        void renderTools(root);
      });
    });
  }

  const list = document.createElement("div");
  list.className = "tools-list";
  root.append(list);

  for (const id of order) {
    if (hidden.has(id)) continue;
    const tool = TOOLS[id];
    const shell = document.createElement("div");
    shell.className = "tool-shell";
    shell.dataset.id = id;
    shell.innerHTML = `
      <div class="tool-shell-bar">
        <span class="tool-drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
        <button type="button" class="tool-hide-btn" title="Unpin ${tool.title}">&times;</button>
      </div>
      <div class="tool-shell-body"></div>
    `;
    list.append(shell);
    tool.render(shell.querySelector<HTMLElement>(".tool-shell-body")!);

    shell
      .querySelector<HTMLButtonElement>(".tool-hide-btn")!
      .addEventListener("click", async () => {
        await setSetting("toolsHidden", [...settings.toolsHidden, id]);
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
