import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSettings } from "./store";

export const GLASS_CHANGED_EVENT = "nepad:glass-changed";

const isLight = () => window.matchMedia("(prefers-color-scheme: light)").matches;

function applyAccent([r, g, b]: [number, number, number]) {
  const target = isLight() ? 0 : 255;
  const mix = isLight() ? 0.45 : 0.4;
  const c = [r, g, b].map((v) => Math.round(v + (target - v) * mix));
  const root = document.documentElement.style;
  root.setProperty("--accent", `rgb(${c[0]}, ${c[1]}, ${c[2]})`);
  root.setProperty("--accent-soft", `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.22)`);
}

async function applyAll() {
  let strength = "frosted";
  try {
    strength = (await getSettings()).glassStrength;
  } catch {
  }
  let ok = false;
  try {
    ok = await invoke<boolean>("apply_glass", { strength });
  } catch {
    ok = false;
  }
  document.documentElement.classList.toggle("no-glass", !ok);
  try {
    const accent = await invoke<[number, number, number] | null>("system_accent");
    if (accent) applyAccent(accent);
  } catch {
  }
}

export async function initGlass(): Promise<void> {
  await applyAll();
  try {
    await getCurrentWindow().onThemeChanged(() => void applyAll());
    await listen(GLASS_CHANGED_EVENT, () => void applyAll());
  } catch {
  }
  window.addEventListener("focus", () => void applyAll());
}
