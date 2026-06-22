import NepaliDate from "nepali-date-converter";
import {
  BS_MONTHS,
  adKey,
  bsDayToAd,
  bsMonthFirstWeekday,
  daysInBsMonth,
} from "./dates";
import { getDayWithCarryOver, getDaySummaries, getRemindersForDate } from "./store";
import { renderTasks } from "./tasks";
import { renderJournal } from "./journal";
import { renderNotes } from "./notes";
import { renderDayReminders } from "./reminders";
import { getHolidays, indexByBsDate } from "./holidays";
import { escapeHtml } from "./escapeHtml";

export function renderCalendar(
  root: HTMLElement,
  focusDate: Date,
  onPick: (date: Date) => void,
): void {
  const focusBs = NepaliDate.fromAD(focusDate);
  let year = focusBs.getYear();
  let monthIndex = focusBs.getMonth();
  let selectedKey: string | null = null;
  let holidayMap: Map<string, string> = new Map();
  let renderGen = 0;
  void getHolidays().then((list) => {
    holidayMap = indexByBsDate(list);
    void draw();
  });

root.innerHTML = `
    <section class="card calendar-card">
      <div class="calendar-header">
        <button type="button" id="cal-prev" class="icon-btn">&#8249;</button>
        <button type="button" id="cal-title" class="calendar-title"></button>
        <button type="button" id="cal-next" class="icon-btn">&#8250;</button>
        <button type="button" id="cal-today" class="icon-btn cal-today-btn">Today</button>
      </div>
      <div id="cal-picker" class="calendar-picker hidden">
        <select id="cal-picker-month"></select>
        <input id="cal-picker-year" type="number" min="2000" max="2090" />
        <button type="button" id="cal-picker-go" class="conv-go-btn">Go</button>
      </div>
      <div class="calendar-legend">
        <span><i class="dot dot-tasks"></i> Tasks</span>
        <span><i class="dot dot-journal"></i> Journal</span>
        <span><i class="dot dot-notes"></i> Notes</span>
        <span><i class="dot dot-holiday"></i> Holiday</span>
      </div>
      <div class="calendar-weekdays">
        <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span class="cal-saturday">Sa</span>
      </div>
      <div id="cal-grid" class="calendar-grid"></div>
      <div id="cal-month-holidays" class="cal-month-holidays"></div>
    </section>
  `;

  const detailWrap = document.createElement("div");
  detailWrap.id = "cal-detail-wrap";
  root.appendChild(detailWrap);

  const title = root.querySelector<HTMLElement>("#cal-title")!;
  const grid = root.querySelector<HTMLElement>("#cal-grid")!;
  const monthHolidaysEl = root.querySelector<HTMLElement>("#cal-month-holidays")!;
  const prevBtn = root.querySelector<HTMLButtonElement>("#cal-prev")!;
  const nextBtn = root.querySelector<HTMLButtonElement>("#cal-next")!;
  const todayBtn = root.querySelector<HTMLButtonElement>("#cal-today")!;
  const picker = root.querySelector<HTMLElement>("#cal-picker")!;
  const pickerMonth = root.querySelector<HTMLSelectElement>("#cal-picker-month")!;
  const pickerYear = root.querySelector<HTMLInputElement>("#cal-picker-year")!;
  const pickerGo = root.querySelector<HTMLButtonElement>("#cal-picker-go")!;

  pickerMonth.innerHTML = BS_MONTHS.map(
    (name, i) => `<option value="${i}">${name}</option>`,
  ).join("");

  const AD_MONTH_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  function adSpanLabel(): string {
    const first = bsDayToAd(year, monthIndex, 1);
    const last = bsDayToAd(year, monthIndex, daysInBsMonth(year, monthIndex));
    const a = `${AD_MONTH_SHORT[first.getMonth()]} ${first.getFullYear()}`;
    const b = `${AD_MONTH_SHORT[last.getMonth()]} ${last.getFullYear()}`;
    return a === b ? a : `${AD_MONTH_SHORT[first.getMonth()]}/${AD_MONTH_SHORT[last.getMonth()]} ${last.getFullYear()}`;
  }

  function renderMonthHolidays() {
    const totalDays = daysInBsMonth(year, monthIndex);
    const entries: { day: number; name: string }[] = [];
    for (let day = 1; day <= totalDays; day++) {
      const name = holidayMap.get(`${year}-${monthIndex}-${day}`);
      if (name) entries.push({ day, name });
    }
    if (entries.length === 0) {
      monthHolidaysEl.innerHTML = "";
      return;
    }
    monthHolidaysEl.innerHTML = entries
      .map((e) => `<div class="cal-month-holiday-row"><span>${e.day} ${BS_MONTHS[monthIndex]}</span><span>${escapeHtml(e.name)}</span></div>`)
      .join("");
  }

  async function refreshDots() {
    try {
      const summaries = await getDaySummaries();
      grid.querySelectorAll<HTMLButtonElement>(".cal-cell").forEach((cell) => {
        const key = cell.dataset.key!;
        const summary = summaries[key];
        const dots = cell.querySelector(".cal-dots")!;
        dots.innerHTML = `
          ${summary?.hasTasks ? '<i class="dot dot-tasks"></i>' : ""}
          ${summary?.hasJournal ? '<i class="dot dot-journal"></i>' : ""}
          ${summary?.hasNotes ? '<i class="dot dot-notes"></i>' : ""}
          ${cell.classList.contains("holiday") ? '<i class="dot dot-holiday"></i>' : ""}
        `;
      });
    } catch {
      // ignore
    }
  }

  async function showDetail(adDate: Date, key: string) {
    detailWrap.innerHTML = "";

    const bs = NepaliDate.fromAD(adDate);
    const holidayName = holidayMap.get(`${bs.getYear()}-${bs.getMonth()}-${bs.getDate()}`);
    if (holidayName) {
      const holidayLine = document.createElement("div");
      holidayLine.className = "cal-detail-holiday";
      holidayLine.textContent = holidayName;
      detailWrap.append(holidayLine);
    }

    const todayKey = adKey(new Date());
    const isFuture = key > todayKey;
    const isPast = key < todayKey;

    const remindersRoot = document.createElement("div");

    if (isFuture) {
      detailWrap.append(remindersRoot);
      void renderDayReminders(remindersRoot, key);
      return;
    }

    const day = await getDayWithCarryOver(key);
    const showTasks = !isPast || day.tasks.length > 0;
    const showJournal = !isPast || day.journal.trim().length > 0;
    const showNotes = !isPast || day.notes.trim().length > 0;
    const showReminders = !isPast || (await getRemindersForDate(key)).length > 0;

    if (showTasks) {
      const tasksRoot = document.createElement("div");
      detailWrap.append(tasksRoot);
      renderTasks(tasksRoot, key, day, () => void refreshDots());
    }
    if (showJournal) {
      const journalRoot = document.createElement("div");
      detailWrap.append(journalRoot);
      renderJournal(journalRoot, key, day);
    }
    if (showNotes) {
      const notesRoot = document.createElement("div");
      detailWrap.append(notesRoot);
      renderNotes(notesRoot, key, day);
    }
    if (showReminders) {
      detailWrap.append(remindersRoot);
      void renderDayReminders(remindersRoot, key);
    }
  }

  async function draw() {
    const gen = ++renderGen;
    title.textContent = `${BS_MONTHS[monthIndex]} ${year}  ·  ${adSpanLabel()}`;
    pickerMonth.value = String(monthIndex);
    pickerYear.value = String(year);
    grid.innerHTML = "";
    renderMonthHolidays();

    try {
      const summaries = await getDaySummaries();
      if (gen !== renderGen) return;
      const firstWeekday = bsMonthFirstWeekday(year, monthIndex);
      const totalDays = daysInBsMonth(year, monthIndex);
      const todayKey = adKey(new Date());

      for (let i = 0; i < firstWeekday; i++) {
        grid.appendChild(document.createElement("div"));
      }

      for (let day = 1; day <= totalDays; day++) {
        const adDate = bsDayToAd(year, monthIndex, day);
        const key = adKey(adDate);
        const summary = summaries[key];
        const holidayName = holidayMap.get(`${year}-${monthIndex}-${day}`);

        const weekday = (firstWeekday + day - 1) % 7;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.dataset.key = key;
        if (holidayName) cell.title = holidayName;
        cell.className =
          "cal-cell" +
          (key === todayKey ? " today" : "") +
          (key === selectedKey ? " selected" : "") +
          (holidayName ? " holiday" : "") +
          (weekday === 6 ? " cal-saturday" : "");
        cell.innerHTML = `
          <span class="cal-day">${day}</span>
          <span class="cal-ad">${adDate.getDate()}</span>
          <span class="cal-dots">
            ${summary?.hasTasks ? '<i class="dot dot-tasks"></i>' : ""}
            ${summary?.hasJournal ? '<i class="dot dot-journal"></i>' : ""}
            ${summary?.hasNotes ? '<i class="dot dot-notes"></i>' : ""}
            ${holidayName ? '<i class="dot dot-holiday"></i>' : ""}
          </span>
        `;
        cell.addEventListener("click", () => {
          selectedKey = key;
          grid
            .querySelectorAll(".cal-cell.selected")
            .forEach((el) => el.classList.remove("selected"));
          cell.classList.add("selected");
          void showDetail(adDate, key);
          onPick(adDate);
        });
        grid.appendChild(cell);
      }
    } catch (err) {
      grid.innerHTML = `<div class="conv-error" style="grid-column: 1 / -1;">Calendar error: ${(err as Error).message ?? String(err)}</div>`;
    }
  }

  prevBtn.addEventListener("click", () => {
    monthIndex -= 1;
    if (monthIndex < 0) {
      monthIndex = 11;
      year -= 1;
    }
    draw();
  });

  nextBtn.addEventListener("click", () => {
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
    draw();
  });

  todayBtn.addEventListener("click", () => {
    const todayBs = NepaliDate.fromAD(new Date());
    year = todayBs.getYear();
    monthIndex = todayBs.getMonth();
    selectedKey = adKey(new Date());
    draw();
  });

  title.addEventListener("click", () => {
    picker.classList.toggle("hidden");
  });

  pickerGo.addEventListener("click", () => {
    const newYear = Number(pickerYear.value);
    const newMonth = Number(pickerMonth.value);
    if (!newYear) return;
    year = newYear;
    monthIndex = newMonth;
    picker.classList.add("hidden");
    draw();
  });

  draw();
}
