import { Store } from "@tauri-apps/plugin-store";

export interface Holiday {
  bsDate: string;
  name: string;
}

interface HolidaysFile {
  version: number;
  holidays: Holiday[];
}

const REMOTE_URL = "https://raw.githubusercontent.com/anjan-NZ/nepal-holidays/main/holidays.json";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SEED: HolidaysFile = {
  version: 1,
  holidays: [{ bsDate: "2082-01-01", name: "Nepali New Year" }],
};

let cacheStore: Store | null = null;

async function cache(): Promise<Store> {
  if (!cacheStore) cacheStore = await Store.load("holidays-cache.json");
  return cacheStore;
}

export async function getHolidays(): Promise<Holiday[]> {
  const store = await cache();
  const cached = await store.get<{ fetchedAt: number; data: HolidaysFile }>("cached");

  const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_MAX_AGE_MS;
  if (isFresh) return cached!.data.holidays;

  try {
    const res = await fetch(REMOTE_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as HolidaysFile;
    if (!Array.isArray(data.holidays)) throw new Error("malformed holidays.json");
    await store.set("cached", { fetchedAt: Date.now(), data });
    await store.save();
    return data.holidays;
  } catch {
    if (cached) return cached.data.holidays;
    return SEED.holidays;
  }
}

export function indexByBsDate(holidays: Holiday[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of holidays) {
    const [y, m, d] = h.bsDate.split("-").map(Number);
    const key = `${y}-${m - 1}-${d}`;
    const existing = map.get(key);
    map.set(key, existing ? `${existing} / ${h.name}` : h.name);
  }
  return map;
}
