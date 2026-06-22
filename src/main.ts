import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { adKey, formatAD, formatBS, shiftDay } from "./lib/dates";
import {
  getDayWithCarryOver,
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
import { enableDragReorder } from "./lib/dragReorder";
import { initEdgeStrip } from "./lib/edgeStrip";
import { initReminderToast } from "./lib/reminderToast";
import { initTimerToast } from "./lib/timerToast";
import { checkForUpdate } from "./lib/updater";

const isEdgeStrip = location.hash === "#edge-strip";
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

  viewRoot.innerHTML = "";
  const tasksRoot = document.createElement("div");
  const remindersRoot = document.createElement("div");
  const journalRoot = document.createElement("div");
  const notesRoot = document.createElement("div");
  const pendingRoot = document.createElement("div");
  viewRoot.append(tasksRoot, journalRoot, notesRoot, remindersRoot, pendingRoot);

  renderTasks(tasksRoot, dateKey, day, () => {});
  void renderReminders(remindersRoot);
  renderJournal(journalRoot, dateKey, day);
  renderNotes(notesRoot, dateKey, day);
  void renderPendingOverview(pendingRoot, (date) => {
    currentDate = date;
    renderActiveView();
  });
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
}

async function bootstrap() {
  const settings = await getStartupSettings();
  showDualDate = settings.showDualDate;
  applyTabOrder(settings.tabOrder);
  setupTabReorder();

  initialRect = await ensureOffscreenStart();

  await listen("nepad:slide-in", () => slideIn());
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
