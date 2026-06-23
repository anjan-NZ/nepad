import { Store } from "@tauri-apps/plugin-store";
import { adKey } from "./dates";

export type TaskStatus = "pending" | "in-progress" | "completed";

export interface Task {
  id: string;
  text: string;
  status: TaskStatus;
  createdAt: number;
}

export interface DayData {
  tasks: Task[];
  journal: string;
  notes: string;
}

export interface Settings {
  showDualDate: boolean;
  autostart: boolean;
  tabOrder: string[];
  toolsOrder: string[];
  toolsHidden: string[];
  edgeStripEnabled: boolean;
  edgeStripPos: { x: number; y: number } | null;
  autoUpdateCheck: boolean;
  timerToastPos: { x: number; y: number } | null;
  theme: "dark" | "light";
}

export interface Reminder {
  id: string;
  text: string;
  datetime: number;
  notified: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  showDualDate: true,
  autostart: false,
  tabOrder: ["home", "calendar", "tools"],
  toolsOrder: ["converter", "pan", "tds", "vat", "timer"],
  toolsHidden: [],
  edgeStripEnabled: false,
  edgeStripPos: null,
  autoUpdateCheck: false,
  timerToastPos: null,
  theme: "dark",
};

const EMPTY_DAY: DayData = { tasks: [], journal: "", notes: "" };

let settingsStore: Store | null = null;
let daysStore: Store | null = null;
let remindersStore: Store | null = null;

async function settings(): Promise<Store> {
  if (!settingsStore) settingsStore = await Store.load("settings.json");
  return settingsStore;
}

async function days(): Promise<Store> {
  if (!daysStore) daysStore = await Store.load("days.json");
  return daysStore;
}

async function reminders(): Promise<Store> {
  if (!remindersStore) remindersStore = await Store.load("reminders.json");
  return remindersStore;
}

export async function getReminders(): Promise<Reminder[]> {
  const store = await reminders();
  return (await store.get<Reminder[]>("list")) ?? [];
}

async function saveReminders(list: Reminder[]): Promise<void> {
  const store = await reminders();
  await store.set("list", list);
  await store.save();
}

export async function addReminder(text: string, datetime: number): Promise<void> {
  const list = await getReminders();
  list.push({
    id: Math.random().toString(36).slice(2, 10),
    text,
    datetime,
    notified: false,
  });
  await saveReminders(list);
}

export async function deleteReminder(id: string): Promise<void> {
  const list = await getReminders();
  await saveReminders(list.filter((r) => r.id !== id));
}

export async function getRemindersForDate(dateKey: string): Promise<Reminder[]> {
  const all = await getReminders();
  return all
    .filter((r) => adKey(new Date(r.datetime)) === dateKey)
    .sort((a, b) => a.datetime - b.datetime);
}

export async function markReminderNotified(id: string): Promise<void> {
  const list = await getReminders();
  const target = list.find((r) => r.id === id);
  if (target) target.notified = true;
  await saveReminders(list);
}

export async function getSettings(): Promise<Settings> {
  const store = await settings();
  const saved = (await store.get<Settings>("settings")) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<Settings> {
  const store = await settings();
  const current = await getSettings();
  const next = { ...current, [key]: value };
  await store.set("settings", next);
  await store.save();
  return next;
}

function normalizeTask(task: Task & { done?: boolean }): Task {
  return {
    id: task.id,
    text: task.text,
    createdAt: task.createdAt,
    status: task.status ?? (task.done ? "completed" : "pending"),
  };
}

function normalizeDay(data: Partial<DayData> | null | undefined): DayData {
  return {
    tasks: (data?.tasks ?? []).map(normalizeTask),
    journal: data?.journal ?? "",
    notes: data?.notes ?? "",
  };
}

export async function getDay(dateKey: string): Promise<DayData> {
  const store = await days();
  const data = await store.get<DayData>(dateKey);
  return normalizeDay(data);
}

export async function saveDay(dateKey: string, data: DayData): Promise<void> {
  const store = await days();
  await store.set(dateKey, data);
  await store.save();
}

export async function getDayWithCarryOver(dateKey: string): Promise<DayData> {
  const store = await days();
  const existing = await store.get<DayData>(dateKey);
  if (existing) return normalizeDay(existing);

  const allKeys = (await store.keys()).filter((k) => k < dateKey).sort();
  const prevKey = allKeys[allKeys.length - 1];
  if (!prevKey) return { ...EMPTY_DAY };

  const prev = await store.get<DayData>(prevKey);
  const carried = (prev?.tasks ?? [])
    .map(normalizeTask)
    .filter((t) => t.status !== "completed");
  return { tasks: carried.map((t) => ({ ...t })), journal: "", notes: "" };
}

export interface OutstandingTask {
  dateKey: string;
  task: Task;
}

export async function getOutstandingTasks(): Promise<OutstandingTask[]> {
  const store = await days();
  const keys = (await store.keys()).sort();
  const result: OutstandingTask[] = [];
  for (const key of keys) {
    const data = await store.get<DayData>(key);
    if (!data) continue;
    for (const task of (data.tasks ?? []).map(normalizeTask)) {
      if (task.status !== "completed") {
        result.push({ dateKey: key, task });
      }
    }
  }
  return result;
}

export async function getDaySummaries(): Promise<
  Record<string, { hasTasks: boolean; hasJournal: boolean; hasNotes: boolean }>
> {
  const store = await days();
  const keys = await store.keys();
  const result: Record<
    string,
    { hasTasks: boolean; hasJournal: boolean; hasNotes: boolean }
  > = {};
  for (const key of keys) {
    const data = await store.get<DayData>(key);
    if (!data) continue;
    result[key] = {
      hasTasks: (data.tasks?.length ?? 0) > 0,
      hasJournal: (data.journal ?? "").trim().length > 0,
      hasNotes: (data.notes ?? "").trim().length > 0,
    };
  }
  return result;
}
