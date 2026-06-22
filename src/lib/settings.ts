import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { getSettings, setSetting, Settings } from "./store";
import { checkForUpdate, installUpdate } from "./updater";
import { getVersion } from "@tauri-apps/api/app";

const LINKEDIN_URL = "https://www.linkedin.com/in/anjan-simkhada/";

export async function renderSettings(
  root: HTMLElement,
  onDualDateChange: (show: boolean) => void,
): Promise<void> {
  const settings = await getSettings();

  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">Settings</h2>
      <label class="setting-row">
        <span>Show Nepali (BS) date</span>
        <input type="checkbox" id="set-dual-date" />
      </label>
      <label class="setting-row">
        <span>Launch NePad on startup</span>
        <input type="checkbox" id="set-autostart" />
      </label>
      <div class="setting-hint">Hotkey: <kbd>Win</kbd> + <kbd>\\</kbd></div>
      <label class="setting-row">
        <span>Show edge strip (drag to reposition)</span>
        <input type="checkbox" id="set-edge-strip" />
      </label>
      <div class="setting-hint">
        Off by default. A small glowing line you can drag anywhere along a screen edge,
        click it to open NePad.
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">Updates</h2>
      <label class="setting-row">
        <span>Automatically check for updates on launch</span>
        <input type="checkbox" id="set-auto-update" />
      </label>
      <button type="button" id="set-check-update" class="conv-go-btn">Check for Updates</button>
      <div id="set-update-status" class="setting-hint"></div>
    </section>

    <section class="card">
      <p class="disclaimer-text">
        NePad is for educational and testing purposes. Do not rely on it fully.
        Always remember to verify.
      </p>
      <p class="disclaimer-author">By Anjan Simkhada</p>
    </section>

    <section class="card">
      <button type="button" id="set-linkedin" class="linkedin-btn" title="Anjan Simkhada on LinkedIn">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.063 2.063 0 1 1 0-4.126 2.063 2.063 0 0 1 0 4.126zM7.119 20.452H3.555V9h3.564v11.452z"/>
        </svg>
        <span>Connect on LinkedIn</span>
      </button>
    </section>

    <section class="card danger-zone">
      <h2 class="card-title">Danger Zone</h2>
      <button type="button" id="set-uninstall-open" class="danger-btn">
        Erase All Data &amp; Uninstall NePad
      </button>
      <div id="set-uninstall-confirm" class="uninstall-confirm hidden">
        <p class="danger-hint">
          This permanently deletes every task, journal entry, note, and reminder, then
          uninstalls NePad. This cannot be undone. Type <strong>DELETE</strong> to confirm.
        </p>
        <input type="text" id="set-uninstall-input" class="uninstall-input" autocomplete="off" />
        <div class="uninstall-actions">
          <button type="button" id="set-uninstall-cancel" class="conv-go-btn">Cancel</button>
          <button type="button" id="set-uninstall-confirm-btn" class="danger-btn" disabled>
            Confirm
          </button>
        </div>
        <div id="set-uninstall-status" class="uninstall-status"></div>
      </div>
    </section>
  `;

  const dualDate = root.querySelector<HTMLInputElement>("#set-dual-date")!;
  const autostart = root.querySelector<HTMLInputElement>("#set-autostart")!;
  const edgeStrip = root.querySelector<HTMLInputElement>("#set-edge-strip")!;

  dualDate.checked = settings.showDualDate;
  autostart.checked = settings.autostart;
  edgeStrip.checked = settings.edgeStripEnabled;

  dualDate.addEventListener("change", async () => {
    await setSetting("showDualDate", dualDate.checked);
    onDualDateChange(dualDate.checked);
  });

  autostart.addEventListener("change", async () => {
    const value = autostart.checked;
    try {
      await invoke("set_autostart", { enabled: value });
      await setSetting("autostart", value);
    } catch {
      autostart.checked = !value;
    }
  });

  edgeStrip.addEventListener("change", async () => {
    await setSetting("edgeStripEnabled", edgeStrip.checked);
    await invoke("set_window_visible", { label: "edge-strip", visible: edgeStrip.checked });
  });

  const autoUpdate = root.querySelector<HTMLInputElement>("#set-auto-update")!;
  const checkUpdateBtn = root.querySelector<HTMLButtonElement>("#set-check-update")!;
  const updateStatus = root.querySelector<HTMLElement>("#set-update-status")!;

  autoUpdate.checked = settings.autoUpdateCheck;
  autoUpdate.addEventListener("change", async () => {
    await setSetting("autoUpdateCheck", autoUpdate.checked);
  });

  checkUpdateBtn.addEventListener("click", async () => {
    checkUpdateBtn.disabled = true;
    const currentVersion = await getVersion();
    updateStatus.textContent = `Checking for updates… (current version ${currentVersion})`;
    const update = await checkForUpdate();
    if (!update) {
      updateStatus.textContent = `You're up to date (v${currentVersion}).`;
      checkUpdateBtn.disabled = false;
      return;
    }
    const wantsUpdate = await ask(`Update v${update.version} is available. Download and install now?`, {
      title: "NePad Update",
      kind: "info",
    });
    if (!wantsUpdate) {
      updateStatus.textContent = `Update v${update.version} available. Not installed.`;
      checkUpdateBtn.disabled = false;
      return;
    }
    updateStatus.textContent = `Update found: v${update.version}. Downloading…`;
    try {
      await installUpdate(update);
    } catch (e) {
      updateStatus.textContent = `Update failed: ${String(e)}`;
      checkUpdateBtn.disabled = false;
    }
  });

  root.querySelector<HTMLButtonElement>("#set-linkedin")!.addEventListener("click", () => {
    void openUrl(LINKEDIN_URL);
  });

  const openBtn = root.querySelector<HTMLButtonElement>("#set-uninstall-open")!;
  const confirmPanel = root.querySelector<HTMLElement>("#set-uninstall-confirm")!;
  const confirmInput = root.querySelector<HTMLInputElement>("#set-uninstall-input")!;
  const cancelBtn = root.querySelector<HTMLButtonElement>("#set-uninstall-cancel")!;
  const confirmBtn = root.querySelector<HTMLButtonElement>("#set-uninstall-confirm-btn")!;
  const status = root.querySelector<HTMLElement>("#set-uninstall-status")!;

  openBtn.addEventListener("click", () => {
    confirmPanel.classList.remove("hidden");
    openBtn.classList.add("hidden");
    confirmInput.value = "";
    confirmInput.focus();
  });

  cancelBtn.addEventListener("click", () => {
    confirmPanel.classList.add("hidden");
    openBtn.classList.remove("hidden");
    status.textContent = "";
  });

  confirmInput.addEventListener("input", () => {
    confirmBtn.disabled = confirmInput.value !== "DELETE";
  });

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmInput.disabled = true;
    status.textContent = "Erasing data and uninstalling…";

    try {
      const outcome = await invoke<{ data_cleared: boolean; uninstaller_launched: boolean }>(
        "erase_data_and_uninstall",
        { confirm: confirmInput.value },
      );
      if (outcome.uninstaller_launched) {
        status.textContent = "Data erased. Launching uninstaller. NePad will now close.";
      } else if (outcome.data_cleared) {
        status.textContent =
          "All data erased. No registered uninstaller was found (this build isn't " +
          "installed via the NSIS installer). Delete the app folder manually to finish.";
        window.setTimeout(() => window.location.reload(), 2500);
      } else {
        status.textContent = "Could not erase data. Nothing was changed.";
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        confirmInput.disabled = false;
      }
    } catch (e) {
      status.textContent = `Failed: ${String(e)}`;
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmInput.disabled = false;
    }
  });
}

export async function getStartupSettings(): Promise<Settings> {
  return getSettings();
}
