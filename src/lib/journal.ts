import { DayData, saveDay } from "./store";

let debounceTimer: number | undefined;

export function flashSaved(el: HTMLElement): void {
  el.textContent = "Saved";
  window.setTimeout(() => {
    el.textContent = "";
  }, 1500);
}

export function renderJournal(
  root: HTMLElement,
  dateKey: string,
  day: DayData,
): void {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">Journal <span class="card-saved" role="status"></span></h2>
      <textarea id="journal-text" class="journal-text" placeholder="Write about your day..."></textarea>
    </section>
  `;

  const textarea = root.querySelector<HTMLTextAreaElement>("#journal-text")!;
  const saved = root.querySelector<HTMLElement>(".card-saved")!;
  textarea.value = day.journal;

  textarea.addEventListener("input", () => {
    day.journal = textarea.value;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      await saveDay(dateKey, day);
      flashSaved(saved);
    }, 400);
  });
}
