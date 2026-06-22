import { invoke } from "@tauri-apps/api/core";

type Mode = "stopwatch" | "countdown";

let mode: Mode = "stopwatch";
let running = false;
let elapsed = 0;
let countdownTotal = 25 * 60 * 1000;
let countdownRemaining = countdownTotal;
let lastTick = 0;
let intervalId: number | undefined;
let lastToastText = "";

function pushToast(text: string) {
  if (text === lastToastText) return;
  lastToastText = text;
  void invoke("show_timer_toast", { text });
}

function hideToast() {
  lastToastText = "";
  void invoke("set_window_visible", { label: "timer-toast", visible: false });
}

function playBeep() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
  osc.onended = () => void ctx.close();
}

function format(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function renderTimer(root: HTMLElement): void {
  if (intervalId !== undefined) {
    window.clearInterval(intervalId);
    intervalId = undefined;
  }

  root.innerHTML = `
    <section class="card timer-card">
      <h2 class="card-title">Timer</h2>
      <div class="timer-tabs">
        <button type="button" class="timer-tab" data-mode="stopwatch">Stopwatch</button>
        <button type="button" class="timer-tab" data-mode="countdown">Countdown</button>
      </div>
      <div id="timer-setup" class="timer-setup hidden">
        <input id="timer-minutes" type="number" min="0" max="180" />
        <span>min</span>
        <input id="timer-seconds" type="number" min="0" max="59" />
        <span>sec</span>
      </div>
      <div id="timer-display" class="timer-display"></div>
      <div class="timer-controls">
        <button type="button" id="timer-start" class="conv-go-btn">Start</button>
        <button type="button" id="timer-pause" class="conv-go-btn hidden">Pause</button>
        <button type="button" id="timer-reset" class="icon-btn timer-reset-btn" title="Reset">&#8635;</button>
      </div>
    </section>
  `;

  const tabs = root.querySelectorAll<HTMLButtonElement>(".timer-tab");
  const setupDiv = root.querySelector<HTMLElement>("#timer-setup")!;
  const minutesInput = root.querySelector<HTMLInputElement>("#timer-minutes")!;
  const secondsInput = root.querySelector<HTMLInputElement>("#timer-seconds")!;
  const display = root.querySelector<HTMLElement>("#timer-display")!;
  const startBtn = root.querySelector<HTMLButtonElement>("#timer-start")!;
  const pauseBtn = root.querySelector<HTMLButtonElement>("#timer-pause")!;
  const resetBtn = root.querySelector<HTMLButtonElement>("#timer-reset")!;

  function refreshDisplay() {
    const text = mode === "stopwatch" ? format(elapsed) : format(countdownRemaining);
    display.textContent = text;
    display.classList.toggle(
      "timer-done",
      mode === "countdown" && countdownRemaining <= 0 && !running,
    );
    if (running) pushToast(text);
  }

  function tick() {
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;
    if (mode === "stopwatch") {
      elapsed += delta;
    } else {
      countdownRemaining -= delta;
      if (countdownRemaining <= 0) {
        countdownRemaining = 0;
        stop();
        playBeep();
      }
    }
    refreshDisplay();
  }

  function updateButtons() {
    startBtn.classList.toggle("hidden", running);
    pauseBtn.classList.toggle("hidden", !running);
  }

  function start() {
    if (running) return;
    if (mode === "countdown" && countdownRemaining <= 0) {
      countdownRemaining = countdownTotal;
    }
    running = true;
    lastTick = Date.now();
    intervalId = window.setInterval(tick, 250);
    updateButtons();
  }

  function stop() {
    running = false;
    if (intervalId !== undefined) window.clearInterval(intervalId);
    intervalId = undefined;
    updateButtons();
    refreshDisplay();
    hideToast();
  }

  function reset() {
    stop();
    if (mode === "stopwatch") elapsed = 0;
    else countdownRemaining = countdownTotal;
    refreshDisplay();
  }

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (running) stop();
      mode = btn.dataset.mode as Mode;
      tabs.forEach((b) => b.classList.toggle("active", b === btn));
      setupDiv.classList.toggle("hidden", mode !== "countdown");
      refreshDisplay();
    });
  });

  function applyCountdownSetup() {
    const mins = Math.max(0, Number(minutesInput.value) || 0);
    const secs = Math.min(59, Math.max(0, Number(secondsInput.value) || 0));
    countdownTotal = mins * 60 * 1000 + secs * 1000;
    if (countdownTotal <= 0) countdownTotal = 25 * 60 * 1000;
    if (!running) countdownRemaining = countdownTotal;
    refreshDisplay();
  }

  minutesInput.addEventListener("change", applyCountdownSetup);
  secondsInput.addEventListener("change", applyCountdownSetup);

  startBtn.addEventListener("click", start);
  pauseBtn.addEventListener("click", stop);
  resetBtn.addEventListener("click", reset);

  tabs.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  setupDiv.classList.toggle("hidden", mode !== "countdown");
  minutesInput.value = String(Math.floor(countdownTotal / 60000));
  secondsInput.value = String(Math.floor(countdownTotal / 1000) % 60);
  updateButtons();
  refreshDisplay();

  if (running) {
    lastTick = Date.now();
    intervalId = window.setInterval(tick, 250);
  }
}
