import { DayData, TaskStatus, saveDay } from "./store";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function formatTime(ms: number | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  "in-progress": "In Progress",
  completed: "Completed",
};

const STATUS_ORDER: TaskStatus[] = ["pending", "in-progress", "completed"];

function nextStatus(status: TaskStatus): TaskStatus {
  const i = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
}

export function renderTasks(
  root: HTMLElement,
  dateKey: string,
  day: DayData,
  onChange: (day: DayData) => void,
): void {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">Tasks</h2>
      <form id="task-form" class="task-form">
        <input id="task-input" type="text" placeholder="Add a task..." autocomplete="off" />
      </form>
      <ul id="task-list" class="task-list"></ul>
    </section>
  `;

  const list = root.querySelector<HTMLUListElement>("#task-list")!;
  const form = root.querySelector<HTMLFormElement>("#task-form")!;
  const input = root.querySelector<HTMLInputElement>("#task-input")!;

  function persist() {
    saveDay(dateKey, day);
    onChange(day);
  }

  function renderList() {
    list.innerHTML = "";
    const sorted = [...day.tasks].sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
    );
    for (const task of sorted) {
      const li = document.createElement("li");
      li.className = "task-item status-" + task.status;
      li.innerHTML = `
        <button type="button" class="status-badge" title="Click to change status"></button>
        <div class="task-body">
          <span class="task-text"></span>
          <span class="task-time"></span>
        </div>
        <button type="button" class="task-del" title="Delete">&times;</button>
      `;
      li.querySelector(".task-text")!.textContent = task.text;
      li.querySelector(".task-time")!.textContent = formatTime(task.createdAt);

      const badge = li.querySelector<HTMLButtonElement>(".status-badge")!;
      badge.textContent = STATUS_LABEL[task.status];
      badge.addEventListener("click", () => {
        task.status = nextStatus(task.status);
        renderList();
        persist();
      });

      li.querySelector(".task-del")!.addEventListener("click", () => {
        day.tasks = day.tasks.filter((t) => t.id !== task.id);
        renderList();
        persist();
      });
      list.appendChild(li);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    day.tasks.push({
      id: uid(),
      text,
      status: "pending",
      createdAt: Date.now(),
    });
    input.value = "";
    renderList();
    persist();
  });

  renderList();
}
