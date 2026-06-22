import { addReminder, deleteReminder, getReminders, getRemindersForDate } from "./store";
import { adKey } from "./dates";

function defaultDateValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function renderReminders(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">Reminders</h2>
      <form id="reminder-form" class="reminder-form">
        <input id="reminder-text" type="text" placeholder="Remind me to..." autocomplete="off" />
        <div class="reminder-row-inputs">
          <input id="reminder-date" type="date" />
          <input id="reminder-time" type="time" />
        </div>
        <button type="submit" class="conv-go-btn reminder-add-btn">Add</button>
      </form>
      <ul id="reminder-list" class="reminder-list"></ul>
    </section>
  `;

  const form = root.querySelector<HTMLFormElement>("#reminder-form")!;
  const textInput = root.querySelector<HTMLInputElement>("#reminder-text")!;
  const dateInput = root.querySelector<HTMLInputElement>("#reminder-date")!;
  const timeInput = root.querySelector<HTMLInputElement>("#reminder-time")!;
  const list = root.querySelector<HTMLElement>("#reminder-list")!;
  dateInput.value = defaultDateValue();

  async function draw() {
    const items = (await getReminders())
      .filter((r) => !r.notified)
      .sort((a, b) => a.datetime - b.datetime);

    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML = `<div class="pending-empty">No reminders set.</div>`;
      return;
    }

    for (const r of items) {
      const row = document.createElement("div");
      row.className = "reminder-row" + (r.datetime < Date.now() ? " overdue" : "");
      row.innerHTML = `
        <div class="reminder-body">
          <span class="reminder-text"></span>
          <span class="reminder-time"></span>
        </div>
        <button type="button" class="task-del" title="Delete">&times;</button>
      `;
      row.querySelector(".reminder-text")!.textContent = r.text;
      row.querySelector(".reminder-time")!.textContent = formatDateTime(r.datetime);
      row.querySelector(".task-del")!.addEventListener("click", async () => {
        await deleteReminder(r.id);
        draw();
      });
      list.appendChild(row);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    const date = dateInput.value;
    const time = timeInput.value;
    if (!text || !date || !time) return;
    const [y, mo, d] = date.split("-").map(Number);
    const [h, m] = time.split(":").map(Number);
    await addReminder(text, new Date(y, mo - 1, d, h, m).getTime());
    textInput.value = "";
    dateInput.value = defaultDateValue();
    timeInput.value = "";
    draw();
  });

  draw();
}

export async function renderDayReminders(root: HTMLElement, dateKey: string): Promise<void> {
  const isFuture = dateKey > adKey(new Date());

  async function draw() {
    const items = await getRemindersForDate(dateKey);

    root.innerHTML = `
      <section class="card">
        <h2 class="card-title">${isFuture ? "Reminders" : "Reminder History"}</h2>
        ${
          isFuture
            ? `<form id="day-reminder-form" class="reminder-form">
                 <input id="day-reminder-text" type="text" placeholder="Remind me to..." autocomplete="off" />
                 <div class="reminder-row-inputs">
                   <input id="day-reminder-time" type="time" />
                 </div>
                 <button type="submit" class="conv-go-btn reminder-add-btn">Add</button>
               </form>`
            : ""
        }
        <ul id="day-reminder-list" class="reminder-list"></ul>
      </section>
    `;

    const list = root.querySelector<HTMLElement>("#day-reminder-list")!;
    if (items.length === 0) {
      list.innerHTML = `<div class="pending-empty">${
        isFuture ? "No reminders set for this day." : "No reminders were set for this day."
      }</div>`;
    }

    for (const r of items) {
      const row = document.createElement("div");
      const missed = !isFuture && !r.notified;
      row.className = "reminder-row" + (missed ? " overdue" : "");
      row.innerHTML = `
        <div class="reminder-body">
          <span class="reminder-text"></span>
          <span class="reminder-time"></span>
        </div>
        <button type="button" class="task-del" title="Delete">&times;</button>
      `;
      row.querySelector(".reminder-text")!.textContent = r.text;
      const status = r.notified ? " · notified" : missed ? " · missed" : "";
      row.querySelector(".reminder-time")!.textContent = formatDateTime(r.datetime) + status;
      row.querySelector(".task-del")!.addEventListener("click", async () => {
        await deleteReminder(r.id);
        draw();
      });
      list.appendChild(row);
    }

    if (isFuture) {
      const form = root.querySelector<HTMLFormElement>("#day-reminder-form")!;
      const textInput = root.querySelector<HTMLInputElement>("#day-reminder-text")!;
      const timeInput = root.querySelector<HTMLInputElement>("#day-reminder-time")!;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = textInput.value.trim();
        const time = timeInput.value;
        if (!text || !time) return;
        const [h, m] = time.split(":").map(Number);
        const [y, mo, d] = dateKey.split("-").map(Number);
        await addReminder(text, new Date(y, mo - 1, d, h, m).getTime());
        textInput.value = "";
        timeInput.value = "";
        draw();
      });
    }
  }

  await draw();
}
