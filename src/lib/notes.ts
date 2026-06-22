import { DayData, saveDay } from "./store";

let debounceTimer: number | undefined;

export function renderNotes(
  root: HTMLElement,
  dateKey: string,
  day: DayData,
): void {
  root.innerHTML = `
    <section class="card collapsible">
      <button type="button" class="card-title collapse-toggle">Quick Notes <span class="chev">&#9662;</span></button>
      <textarea id="scratch-text" class="journal-text" placeholder="Jot something down..."></textarea>
    </section>
  `;

  const card = root.querySelector<HTMLElement>(".card")!;
  const toggle = root.querySelector<HTMLButtonElement>(".collapse-toggle")!;
  const textarea = root.querySelector<HTMLTextAreaElement>("#scratch-text")!;

  textarea.value = day.notes;

  toggle.addEventListener("click", () => {
    card.classList.toggle("collapsed");
  });

  textarea.addEventListener("input", () => {
    day.notes = textarea.value;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => saveDay(dateKey, day), 400);
  });
}
