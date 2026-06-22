import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getSettings, setSetting } from "./store";

const LABEL = "timer-toast";
const DRAG_THRESHOLD_PX = 4;

export async function initTimerToast(): Promise<void> {
  const toastEl = document.querySelector<HTMLButtonElement>("#timer-toast")!;
  const textEl = document.querySelector<HTMLElement>("#timer-toast-text")!;
  const win = getCurrentWindow();
  const settings = await getSettings();

  if (settings.timerToastPos) {
    await invoke("move_window", { label: LABEL, x: settings.timerToastPos.x, y: settings.timerToastPos.y });
  }

  await listen<string>("nepad:timer-tick", (event) => {
    textEl.textContent = event.payload;
  });

  toastEl.style.touchAction = "none";

  toastEl.addEventListener("pointerdown", (downEvent) => {
    if (downEvent.button !== 0) return;
    const pointerId = downEvent.pointerId;
    const downX = downEvent.screenX;
    const downY = downEvent.screenY;
    let dragging = false;

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId || dragging) return;
      if (
        Math.abs(moveEvent.screenX - downX) < DRAG_THRESHOLD_PX &&
        Math.abs(moveEvent.screenY - downY) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      dragging = true;
      void win.startDragging();
    }

    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!dragging) {
        void invoke("toggle_panel");
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  let saveTimer: number | undefined;
  await win.onMoved(() => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const pos = await win.outerPosition();
      await setSetting("timerToastPos", { x: pos.x, y: pos.y });
    }, 500);
  });
}
