import NepaliDate, { dateConfigMap } from "nepali-date-converter";

const WEEKDAYS_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function adKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDay(date: Date, delta: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

export function formatAD(date: Date): string {
  const weekday = WEEKDAYS_EN[date.getDay()];
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${day} ${month} ${date.getFullYear()}`;
}

export function formatBS(date: Date, lang: "en" | "np" = "en"): string {
  const bs = NepaliDate.fromAD(date);
  return bs.format("ddd DD, MMMM YYYY", lang);
}

export function weekdayName(date: Date): string {
  return WEEKDAYS_EN[date.getDay()];
}

export const BS_MONTHS = [
  "Baisakh",
  "Jestha",
  "Asar",
  "Shrawan",
  "Bhadra",
  "Aswin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
];

export function daysInBsMonth(year: number, monthIndex: number): number {
  const monthName = BS_MONTHS[monthIndex] as keyof (typeof dateConfigMap)[string];
  return dateConfigMap[String(year)]?.[monthName] ?? 30;
}

export function bsMonthFirstWeekday(year: number, monthIndex: number): number {
  return new NepaliDate(year, monthIndex, 1).getDay();
}

export function bsDayToAd(year: number, monthIndex: number, day: number): Date {
  return new NepaliDate(year, monthIndex, day).toJsDate();
}

export interface ConvertResult {
  formatted: string;
  weekday: string;
}

export function bsToAd(year: number, month: number, day: number): ConvertResult {
  const bs = new NepaliDate(year, month - 1, day);
  const ad = bs.toJsDate();
  return { formatted: formatAD(ad), weekday: weekdayName(ad) };
}

export function adToBs(date: Date): ConvertResult {
  const bs = NepaliDate.fromAD(date);
  return {
    formatted: bs.format("ddd DD, MMMM YYYY"),
    weekday: bs.format("ddd"),
  };
}
