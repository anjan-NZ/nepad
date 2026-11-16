import { getSettings, setSetting } from "./store";

export interface Fold {
  el: HTMLElement;
  body: HTMLElement;
  refresh: () => void;
}

let foldedIds = new Set<string>();

export async function loadFoldState(): Promise<void> {
  foldedIds = new Set((await getSettings()).todayFolded ?? []);
}

export function makeFold(
  id: string,
  title: string,
  summary: () => string | Promise<string>,
  onFold?: () => void,
): Fold {
  const el = document.createElement("div");
  el.className = "fold";

  const row = document.createElement("button");
  row.type = "button";
  row.className = "fold-row";
  const titleEl = document.createElement("span");
  titleEl.className = "fold-title";
  titleEl.textContent = title;
  const sumEl = document.createElement("span");
  sumEl.className = "fold-sum";
  const chev = document.createElement("span");
  chev.className = "fold-chev";
  chev.textContent = "▾";
  row.append(titleEl, sumEl, chev);

  const body = document.createElement("div");
  body.className = "fold-body";
  el.append(row, body);

  const refresh = () => {
    void Promise.resolve(summary()).then((text) => {
      sumEl.textContent = text;
    });
  };

  const apply = (open: boolean) => {
    el.classList.toggle("open", open);
    row.setAttribute("aria-expanded", String(open));
  };

  const set = (open: boolean) => {
    apply(open);
    if (open) foldedIds.delete(id);
    else foldedIds.add(id);
    void setSetting("todayFolded", [...foldedIds]);
    if (!open) {
      refresh();
      onFold?.();
    }
  };

  row.addEventListener("click", () => set(true));

  body.addEventListener(
    "click",
    (e) => {
      if (!(e.target as HTMLElement).closest(".card-title")) return;
      e.stopPropagation();
      e.preventDefault();
      set(false);
      row.focus();
    },
    true,
  );

  apply(!foldedIds.has(id));
  refresh();
  return { el, body, refresh };
}

export function wordSummary(text: string): string {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  return n === 0 ? "empty" : n === 1 ? "1 word" : `${n} words`;
}
