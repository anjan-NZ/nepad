import { adToBs, bsToAd, BS_MONTHS } from "./dates";

export function renderConverter(root: HTMLElement): void {
  root.innerHTML = `
    <section class="card">
      <h2 class="card-title">Date Converter</h2>
      <div class="conv-direction">
        <button type="button" class="conv-dir-btn active" data-dir="bs-ad">BS &rarr; AD</button>
        <button type="button" class="conv-dir-btn" data-dir="ad-bs">AD &rarr; BS</button>
      </div>

      <div id="conv-bs-inputs" class="conv-inputs-group">
        <input id="conv-bs-quick" type="text" placeholder="or type DD/MM/YYYY (BS)" class="conv-quick-input" />
        <div class="conv-inputs">
          <input id="conv-bs-year" type="number" placeholder="Year" min="1970" max="2100" />
          <select id="conv-bs-month"></select>
          <input id="conv-bs-day" type="number" placeholder="Day" min="1" max="32" />
        </div>
      </div>

      <div id="conv-ad-inputs" class="conv-inputs hidden">
        <input id="conv-ad-date" type="date" />
      </div>

      <button type="button" id="conv-go" class="conv-go-btn" disabled>Convert</button>

      <div id="conv-result" class="conv-result"></div>
    </section>
  `;

  const monthSelect = root.querySelector<HTMLSelectElement>("#conv-bs-month")!;
  monthSelect.innerHTML = BS_MONTHS.map(
    (name, i) => `<option value="${i + 1}">${name}</option>`,
  ).join("");

  const dirBtns = root.querySelectorAll<HTMLButtonElement>(".conv-dir-btn");
  const bsInputs = root.querySelector<HTMLElement>("#conv-bs-inputs")!;
  const adInputs = root.querySelector<HTMLElement>("#conv-ad-inputs")!;
  const result = root.querySelector<HTMLElement>("#conv-result")!;
  const goBtn = root.querySelector<HTMLButtonElement>("#conv-go")!;

  let direction: "bs-ad" | "ad-bs" = "bs-ad";

  const bsQuick = root.querySelector<HTMLInputElement>("#conv-bs-quick")!;
  const bsYear = root.querySelector<HTMLInputElement>("#conv-bs-year")!;
  const bsDay = root.querySelector<HTMLInputElement>("#conv-bs-day")!;
  const adDate = root.querySelector<HTMLInputElement>("#conv-ad-date")!;

  function updateGoState() {
    const ready =
      direction === "bs-ad"
        ? bsQuick.value.trim() !== "" || (bsYear.value !== "" && bsDay.value !== "")
        : adDate.value !== "";
    goBtn.disabled = !ready;
  }

  [bsQuick, bsYear, bsDay, adDate].forEach((input) => {
    input.addEventListener("input", updateGoState);
  });

  dirBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      direction = btn.dataset.dir as "bs-ad" | "ad-bs";
      dirBtns.forEach((b) => b.classList.toggle("active", b === btn));
      bsInputs.classList.toggle("hidden", direction !== "bs-ad");
      adInputs.classList.toggle("hidden", direction !== "ad-bs");
      result.innerHTML = "";
      updateGoState();
    });
  });

  updateGoState();

  goBtn.addEventListener("click", () => {
    try {
      if (direction === "bs-ad") {
        const quick = root.querySelector<HTMLInputElement>("#conv-bs-quick")!.value.trim();
        let year: number;
        let month: number;
        let day: number;
        const quickMatch = quick.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
        if (quickMatch) {
          day = Number(quickMatch[1]);
          month = Number(quickMatch[2]);
          year = Number(quickMatch[3]);
        } else if (quick) {
          throw new Error("Type the BS date as DD/MM/YYYY");
        } else {
          year = Number(root.querySelector<HTMLInputElement>("#conv-bs-year")!.value);
          month = Number(monthSelect.value);
          day = Number(root.querySelector<HTMLInputElement>("#conv-bs-day")!.value);
        }
        if (!year || !day) throw new Error("Enter a complete BS date");
        const { formatted, weekday } = bsToAd(year, month, day);
        result.innerHTML = `<div class="conv-line">${formatted}</div><div class="conv-weekday">${weekday}</div>`;
      } else {
        const raw = root.querySelector<HTMLInputElement>("#conv-ad-date")!.value;
        if (!raw) throw new Error("Pick an AD date");
        const [y, m, d] = raw.split("-").map(Number);
        const { formatted, weekday } = adToBs(new Date(y, m - 1, d));
        result.innerHTML = `<div class="conv-line">${formatted}</div><div class="conv-weekday">${weekday}</div>`;
      }
    } catch (err) {
      result.innerHTML = `<div class="conv-error">${(err as Error).message}</div>`;
    }
  });
}
