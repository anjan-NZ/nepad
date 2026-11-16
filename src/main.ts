import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { adKey, formatAD, formatBS, shiftDay } from "./lib/dates";
import {
  addReminder,
  getDayWithCarryOver,
  getOutstandingTasks,
  OutstandingTask,
  getReminders,
  markReminderNotified,
  setSetting,
} from "./lib/store";
import { renderTasks } from "./lib/tasks";
import { renderJournal } from "./lib/journal";
import { renderNotes } from "./lib/notes";
import { renderTools } from "./lib/tools";
import { renderSettings, getStartupSettings } from "./lib/settings";
import { renderCalendar } from "./lib/calendar";
import { renderPendingOverview } from "./lib/pendingOverview";
import { renderReminders } from "./lib/reminders";
import { loadFoldState, makeFold, wordSummary } from "./lib/todayFold";
import { enableDragReorder } from "./lib/dragReorder";
import { initEdgeStrip } from "./lib/edgeStrip";
import { initReminderToast } from "./lib/reminderToast";
import { initTimerToast } from "./lib/timerToast";
import { checkForUpdate } from "./lib/updater";
import { initGlass } from "./lib/glass";

const isEdgeStrip = location.hash === "#edge-strip";
if (!isEdgeStrip) void initGlass();
if (isEdgeStrip) {
  document.body.classList.add("is-edge-strip");
  void initEdgeStrip();
}

const isReminderToast = location.hash === "#reminder-toast";
if (isReminderToast) {
  document.body.classList.add("is-reminder-toast");
  void initReminderToast();
}

const isTimerToast = location.hash === "#timer-toast";
if (isTimerToast) {
  document.body.classList.add("is-timer-toast");
  void initTimerToast();
}

if (!import.meta.env.DEV) {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (
      k === "f12" ||
      (e.ctrlKey && e.shiftKey && (k === "i" || k === "j" || k === "c")) ||
      (e.ctrlKey && k === "u")
    ) {
      e.preventDefault();
    }
  });
}

let updateToastAt = 0;
const UPDATE_TOAST_WINDOW_MS = 35000;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ViewName = "home" | "tools" | "settings" | "calendar";

let currentDate = new Date();
let currentView: ViewName = "home";
let showDualDate = true;
let initialRect: Rect | null = null;

const viewRoot = document.querySelector<HTMLElement>("#view-root")!;
const bsDateEl = document.querySelector<HTMLElement>("#bs-date")!;
const adDateEl = document.querySelector<HTMLElement>("#ad-date")!;
const tabBtns = document.querySelectorAll<HTMLButtonElement>(".tab-btn");

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function animateX(
  fromX: number,
  y: number,
  width: number,
  height: number,
  toX: number,
  duration = 220,
): Promise<void> {
  const start = performance.now();
  return new Promise((resolve) => {
    function step(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const x = fromX + (toX - fromX) * easeOutCubic(t);
      invoke("set_main_geometry", { x, y, width, height });
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

async function ensureOffscreenStart(): Promise<Rect> {
  const rect = await invoke<Rect>("get_main_default_rect");
  await invoke("set_main_geometry", {
    x: rect.x + rect.width,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
  return rect;
}

async function slideIn() {
  const rect = initialRect ?? (await invoke<Rect>("get_main_default_rect"));
  await invoke("set_main_geometry", {
    x: rect.x + rect.width,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
  await invoke("show_main");
  await animateX(rect.x + rect.width, rect.y, rect.width, rect.height, rect.x);
}

async function slideOut() {
  const pos = await invoke<[number, number] | null>("get_main_position");
  const rect = initialRect ?? (await invoke<Rect>("get_main_default_rect"));
  const x = pos ? pos[0] : rect.x;
  const y = pos ? pos[1] : rect.y;
  await animateX(x, y, rect.width, rect.height, x + rect.width);
  await invoke("hide_main");
}

function renderHeader(): string {
  const key = adKey(currentDate);
  adDateEl.textContent = formatAD(currentDate);
  bsDateEl.textContent = showDualDate ? formatBS(currentDate) : "";
  bsDateEl.style.display = showDualDate ? "" : "none";
  return key;
}

async function renderHome() {
  const dateKey = renderHeader();
  const day = await getDayWithCarryOver(dateKey);
  await loadFoldState();

  const isEarlier = (o: OutstandingTask) =>
    o.dateKey !== dateKey && !day.tasks.some((t) => t.id === o.task.id);
  const earlierCount = async () => (await getOutstandingTasks()).filter(isEarlier).length;
  const upcoming = async () =>
    (await getReminders()).filter((r) => !r.notified).sort((a, b) => a.datetime - b.datetime);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  viewRoot.innerHTML = "";

  const strip = document.createElement("div");
  strip.className = "today-strip";
  strip.innerHTML = `
    <div class="today-stat"><b id="stat-open">0</b><span>open today</span></div>
    <div class="today-stat"><b id="stat-earlier">0</b><span>from earlier</span></div>
    <div class="today-stat"><b id="stat-reminders">0</b><span>reminders</span></div>
  `;
  const statOpen = strip.querySelector<HTMLElement>("#stat-open")!;
  const statEarlier = strip.querySelector<HTMLElement>("#stat-earlier")!;
  const statReminders = strip.querySelector<HTMLElement>("#stat-reminders")!;

  const tasksRoot = document.createElement("div");

  const earlier = makeFold("earlier", "From earlier days", async () =>
    plural(await earlierCount(), "task"),
  );
  const reminders = makeFold(
    "reminders",
    "Reminders",
    async () => {
      const next = (await upcoming())[0];
      if (!next) return "none";
      const time = new Date(next.datetime).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      return `${time}, ${next.text}`;
    },
    () => void refreshStats(),
  );
  const notes = makeFold("notes", "Quick Notes", () => wordSummary(day.notes));
  const journal = makeFold("journal", "Journal", () => wordSummary(day.journal));

  async function refreshStats() {
    statOpen.textContent = String(day.tasks.filter((t) => t.status !== "completed").length);
    const n = await earlierCount();
    statEarlier.textContent = String(n);
    earlier.el.classList.toggle("hidden", n === 0);
    statReminders.textContent = String((await upcoming()).length);
    earlier.refresh();
    reminders.refresh();
  }

  const drawEarlier = () =>
    renderPendingOverview(
      earlier.body,
      (date) => {
        currentDate = date;
        renderActiveView();
      },
      { title: "From earlier days", filter: isEarlier },
    );

  viewRoot.append(strip, tasksRoot, earlier.el, reminders.el, notes.el, journal.el);

  renderTasks(tasksRoot, dateKey, day, () => {
    void drawEarlier();
    void refreshStats();
  });
  void drawEarlier();
  void renderReminders(reminders.body);
  new MutationObserver(() => void refreshStats()).observe(reminders.body, {
    childList: true,
    subtree: true,
  });
  renderNotes(notes.body, dateKey, day);
  renderJournal(journal.body, dateKey, day);
  void refreshStats();
}

function renderActiveView() {
  if (currentView === "home") {
    void renderHome();
  } else if (currentView === "tools") {
    renderHeader();
    void renderTools(viewRoot);
  } else if (currentView === "calendar") {
    renderHeader();
    renderCalendar(viewRoot, currentDate, () => {});
  } else {
    renderHeader();
    void renderSettings(viewRoot, (show) => {
      showDualDate = show;
      renderHeader();
    });
  }
}

function setView(view: ViewName) {
  currentView = view;
  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  renderActiveView();
}

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view as ViewName));
});

function applyTabOrder(order: string[]) {
  const nav = document.querySelector<HTMLElement>(".tabs")!;
  const settingsBtn = nav.querySelector<HTMLElement>('.tab-btn[data-view="settings"]')!;
  for (const view of order) {
    const btn = nav.querySelector<HTMLElement>(`.tab-btn[data-view="${view}"]`);
    if (btn) nav.insertBefore(btn, settingsBtn);
  }
}

function setupTabReorder() {
  const nav = document.querySelector<HTMLElement>(".tabs")!;
  enableDragReorder(
    nav,
    ".tab-btn.reorderable",
    (el) => el.dataset.view!,
    (orderedIds) => {
      void setSetting("tabOrder", orderedIds);
    },
    { orientation: "horizontal" },
  );
}

document.querySelector("#day-prev")!.addEventListener("click", () => {
  currentDate = shiftDay(currentDate, -1);
  renderActiveView();
});
document.querySelector("#day-next")!.addEventListener("click", () => {
  currentDate = shiftDay(currentDate, 1);
  renderActiveView();
});
document.querySelector("#day-today")!.addEventListener("click", () => {
  currentDate = new Date();
  renderActiveView();
});
document.querySelector("#hide-btn")!.addEventListener("click", () => {
  invoke("toggle_panel");
});
document.querySelector("#date-block")!.addEventListener("click", () => {
  setView("calendar");
});

async function checkReminders() {
  const due = (await getReminders()).filter(
    (r) => !r.notified && r.datetime <= Date.now(),
  );
  for (const r of due) {
    await invoke("show_reminder_toast", { text: r.text });
    await markReminderNotified(r.id);
  }
}

async function checkForUpdateOnLaunch() {
  const update = await checkForUpdate();
  if (!update) return;
  await invoke("show_reminder_toast", {
    text: `Update available: v${update.version}. Open Settings to install.`,
  });
  updateToastAt = Date.now();
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function setupKeyboard() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isTypingTarget(e.target) || e.defaultPrevented) return;
      void invoke("toggle_panel");
      return;
    }
    if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    if (e.key === "," ) {
      e.preventDefault();
      setView("settings");
      return;
    }
    if (e.key >= "1" && e.key <= "3") {
      const tabs = document.querySelectorAll<HTMLElement>(".tabs .tab-btn.reorderable");
      const btn = tabs[Number(e.key) - 1];
      if (btn?.dataset.view) {
        e.preventDefault();
        setView(btn.dataset.view as ViewName);
      }
    }
  });
}

async function bootstrap() {
  const settings = await getStartupSettings();
  showDualDate = settings.showDualDate;
  applyTabOrder(settings.tabOrder);
  setupTabReorder();

  initialRect = await ensureOffscreenStart();

  await listen("nepad:slide-in", async () => {
    if (updateToastAt && Date.now() - updateToastAt < UPDATE_TOAST_WINDOW_MS) {
      setView("settings");
    }
    updateToastAt = 0;
    await slideIn();
  });
  await listen<{ text: string; minutes: number }>("nepad:reminder-snooze", (event) => {
    const { text, minutes } = event.payload;
    if (!text || !(minutes > 0)) return;
    void addReminder(text, Date.now() + minutes * 60000);
  });
  setupKeyboard();
  await listen("nepad:slide-out", () => slideOut());
  await listen("nepad:open-settings", () => setView("settings"));

  await checkReminders();
  window.setInterval(checkReminders, 20000);

  if (settings.autoUpdateCheck) {
    void checkForUpdateOnLaunch();
  }

  setView("home");
  if (!(await invoke<boolean>("was_autostart_launch"))) {
    await slideIn();
  }
}

if (!isEdgeStrip && !isReminderToast && !isTimerToast) {
  bootstrap();
}
