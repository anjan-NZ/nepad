import { keyToDate } from "./dates";
import { getOutstandingTasks, TaskStatus } from "./store";

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  "in-progress": "In Progress",
  completed: "Completed",
};

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export async function renderPendingOverview(
  root: HTMLElement,
  onJump: (date: Date) => void,
): Promise<void> {
  root.innerHTML = `
    <section class="card pending-overview">
      <h2 class="card-title">Pending Tasks</h2>
      <div id="pending-list" class="pending-list"></div>
    </section>
  `;

  const list = root.querySelector<HTMLElement>("#pending-list")!;
  const items = await getOutstandingTasks();

  if (items.length === 0) {
    list.innerHTML = `<div class="pending-empty">Nothing outstanding. Nice.</div>`;
    return;
  }

  for (const { dateKey, task } of items) {
    const date = keyToDate(dateKey);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "pending-row status-" + task.status;
    row.innerHTML = `
      <span class="pending-date">${formatShortDate(date)}</span>
      <span class="pending-text"></span>
      <span class="status-badge pending-status">${STATUS_LABEL[task.status]}</span>
    `;
    row.querySelector(".pending-text")!.textContent = task.text;
    row.addEventListener("click", () => onJump(date));
    list.appendChild(row);
  }
}
