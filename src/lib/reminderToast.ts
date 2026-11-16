import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

const LABEL = "reminder-toast";
const AUTO_DISMISS_MS = 30000;

export async function initReminderToast(): Promise<void> {
  const textEl = document.querySelector<HTMLElement>("#reminder-toast-text")!;
  const openBtn = document.querySelector<HTMLButtonElement>("#reminder-toast-open")!;
  const dismissBtn = document.querySelector<HTMLButtonElement>("#reminder-toast-dismiss")!;
  const snooze10 = document.querySelector<HTMLButtonElement>("#reminder-toast-snooze10")!;
  const snooze60 = document.querySelector<HTMLButtonElement>("#reminder-toast-snooze60")!;

  let dismissTimer: number | undefined;
  let currentText = "";

  function hideToast() {
    window.clearTimeout(dismissTimer);
    void invoke("set_window_visible", { label: LABEL, visible: false });
  }

  function scheduleAutoDismiss() {
    window.clearTimeout(dismissTimer);
    dismissTimer = window.setTimeout(() => {
      void invoke("set_window_visible", { label: LABEL, visible: false });
    }, AUTO_DISMISS_MS);
  }

  await listen<string>("nepad:reminder", (event) => {
    currentText = event.payload;
    textEl.textContent = currentText;
    const isUpdate = currentText.startsWith("Update available");
    snooze10.classList.toggle("hidden", isUpdate);
    snooze60.classList.toggle("hidden", isUpdate);
    scheduleAutoDismiss();
  });

  function snooze(minutes: number) {
    void emit("nepad:reminder-snooze", { text: currentText, minutes });
    hideToast();
  }
  snooze10.addEventListener("click", () => snooze(10));
  snooze60.addEventListener("click", () => snooze(60));

  openBtn.addEventListener("click", () => {
    hideToast();
    void invoke("toggle_panel");
  });

  dismissBtn.addEventListener("click", hideToast);
}
