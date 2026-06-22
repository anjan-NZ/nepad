import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const LABEL = "reminder-toast";
const AUTO_DISMISS_MS = 10000;

export async function initReminderToast(): Promise<void> {
  const textEl = document.querySelector<HTMLElement>("#reminder-toast-text")!;
  const openBtn = document.querySelector<HTMLButtonElement>("#reminder-toast-open")!;
  const dismissBtn = document.querySelector<HTMLButtonElement>("#reminder-toast-dismiss")!;

  let dismissTimer: number | undefined;

  function scheduleAutoDismiss() {
    window.clearTimeout(dismissTimer);
    dismissTimer = window.setTimeout(() => {
      void invoke("set_window_visible", { label: LABEL, visible: false });
    }, AUTO_DISMISS_MS);
  }

  await listen<string>("nepad:reminder", (event) => {
    textEl.textContent = event.payload;
    scheduleAutoDismiss();
  });

  openBtn.addEventListener("click", () => {
    window.clearTimeout(dismissTimer);
    void invoke("set_window_visible", { label: LABEL, visible: false });
    void invoke("toggle_panel");
  });

  dismissBtn.addEventListener("click", () => {
    window.clearTimeout(dismissTimer);
    void invoke("set_window_visible", { label: LABEL, visible: false });
  });
}
