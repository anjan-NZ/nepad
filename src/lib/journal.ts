import { DayData, saveDay } from "./store";

let debounceTimer: number | undefined;

export function renderJournal(
  root: HTMLElement,
  dateKey: string,
  day: DayData,
): void {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">Journal</h2>
      <textarea id="journal-text" class="journal-text" placeholder="Write about your day..."></textarea>
    </section>
  `;

  const textarea = root.querySelector<HTMLTextAreaElement>("#journal-text")!;
  textarea.value = day.journal;

  textarea.addEventListener("input", () => {
    day.journal = textarea.value;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => saveDay(dateKey, day), 400);
  });
}
