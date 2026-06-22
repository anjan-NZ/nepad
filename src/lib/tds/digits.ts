const DEV_DIGIT_BASE = 0x0966;

export function devToArabic(s: string): string {
  return s.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - DEV_DIGIT_BASE));
}

export function parseAmount(s: string): number {
  return Number(s.replace(/,/g, ""));
}
