import { devToArabic } from "./digits";
import { parseTdsLines } from "./parseLines";
import { TdsParseResult } from "./types";

export function parseTdsHtml(htmlText: string, sourceFile: string): TdsParseResult {
  const dom = new DOMParser().parseFromString(htmlText, "text/html");
  const lines: string[] = (dom.body?.textContent ?? "").split(/\r?\n/);

  for (const table of Array.from(dom.querySelectorAll("table"))) {
    for (const tr of Array.from(table.querySelectorAll("tr"))) {
      const cells = Array.from(tr.querySelectorAll("td,th"))
        .map((td) => (td.textContent ?? "").trim())
        .filter((c) => c.length > 0);
      if (cells.length === 0) continue;
      const joined = cells.join(" ");

      if (/\b1\d{4}\b/.test(joined) || /भभचर/.test(joined)) {
        lines.push(joined);
        continue;
      }
      if (cells.length < 5) continue;

      const snS = devToArabic(cells[0]).trim();
      const panS = devToArabic(cells[1]).trim();
      const nameS = cells[2].trim();
      const dateS = devToArabic(cells[3]).trim();
      const payS = devToArabic(cells[4]).replace(/,/g, "").trim();
      const tdsS = cells.length > 5 ? devToArabic(cells[5]).replace(/,/g, "").trim() : "0";
      const last = cells[cells.length - 1].trim();
      const cal = last === "AD" || last === "BS" ? last : "AD";

      if (!/^\d+$/.test(snS)) continue;
      if (!/^\d{9,10}$/.test(panS)) continue;
      const pay = Number(payS);
      const tds = Number(tdsS);
      if (!Number.isFinite(pay) || !Number.isFinite(tds)) continue;

      lines.push(`${nameS}  ${panS}  ${dateS}  ${pay.toFixed(2)}  ${tds.toFixed(2)}  ${snS}  ${cal}`);
    }
  }

  return parseTdsLines(lines, sourceFile, "html");
}
