import { devToArabic, parseAmount } from "./digits";
import { TdsFileMeta, TdsParseResult, TdsRecord } from "./types";

export async function parseTdsPdf(bytes: Uint8Array, sourceFile: string): Promise<TdsParseResult> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")).default;
  GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await getDocument({ data: bytes }).promise;

  interface Word {
    text: string;
    x: number;
    y: number;
    page: number;
  }
  const words: Word[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      const text = (item.str ?? "").trim();
      if (!text) continue;
      words.push({ text, x: item.transform[4], y: item.transform[5], page: p });
    }
  }

  if (words.length === 0) {
    throw new Error(
      "No extractable text found in this PDF (likely a scanned/flattened export with no text layer — OCR would be needed, not supported)",
    );
  }

  words.sort((a, b) => a.page - b.page || b.y - a.y);
  const rows: Word[][] = [];
  let current: Word[] = [];
  let refY = 0;
  let refPage = 0;
  for (const w of words) {
    if (current.length === 0) {
      current = [w];
      refY = w.y;
      refPage = w.page;
      continue;
    }
    if (w.page === refPage && Math.abs(w.y - refY) <= 9) {
      current.push(w);
      refY = (refY + w.y) / 2;
    } else {
      rows.push(current);
      current = [w];
      refY = w.y;
      refPage = w.page;
    }
  }
  if (current.length) rows.push(current);

  const meta: TdsFileMeta = {
    sourceFile,
    taxpayerName: "",
    pan: "",
    periodFrom: "",
    periodTo: "",
    submissionNo: "",
    recordVerifiedDate: "",
    format: "pdf",
  };

  const records: TdsRecord[] = [];
  const seenHeadingCodes = new Set<string>();
  let activeHeading: { code: string; label: string } | null = null;
  let voucherSectionReached = false;
  let periodRowIndex = -1;
  const pureTextRows: { index: number; text: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (voucherSectionReached) break;
    const row = rows[i].slice().sort((a, b) => a.x - b.x);

    const codeTok = row.find((w) => /^\d{5}$/.test(w.text));
    const latinLabel = row
      .filter((w) => /^[A-Za-z][A-Za-z .]*$/.test(w.text))
      .map((w) => w.text)
      .join(" ")
      .trim();
    if (codeTok && latinLabel) {
      if (seenHeadingCodes.has(codeTok.text)) {
        voucherSectionReached = true;
        break;
      }
      seenHeadingCodes.add(codeTok.text);
      activeHeading = { code: codeTok.text, label: latinLabel };
      continue;
    }

    if (!activeHeading) {
      const rowText = row.map((w) => devToArabic(w.text)).join(" ");
      const dates = [...rowText.matchAll(/\d{4}\.\d{1,2}\.\d{1,2}/g)].map((m) => m[0]);
      if (dates.length >= 2 && periodRowIndex === -1) {
        meta.periodFrom = dates[0];
        meta.periodTo = dates[1];
        if (dates.length >= 3) meta.recordVerifiedDate = dates[2];
        periodRowIndex = i;
        continue;
      }
      const digitTokens = row
        .map((w) => devToArabic(w.text))
        .filter((t) => /^\d+$/.test(t));
      const nineDigit = digitTokens.find((t) => t.length === 9);
      if (nineDigit && !meta.pan) {
        meta.pan = nineDigit;
        continue;
      }
      const longDigit = digitTokens.find((t) => t.length >= 11);
      if (longDigit && !meta.submissionNo) {
        meta.submissionNo = longDigit;
        continue;
      }
      const isPureText =
        row.length > 0 &&
        !rowText.includes("@") &&
        row.every((w) => {
          const core = w.text.replace(/[:.\s,]/g, "");
          return core.length === 0 || !/[A-Za-z0-9]/.test(core);
        }) &&
        row.some((w) => /[^\x00-\x7F]/.test(w.text));
      if (isPureText) {
        const valueText = row
          .filter((w) => !w.text.trim().endsWith(":"))
          .map((w) => w.text)
          .join(" ")
          .trim();
        if (valueText) pureTextRows.push({ index: i, text: valueText });
      }
      continue;
    }

    let sn: string | null = null;
    let pan: string | null = null;
    let date: string | null = null;
    let dateType: "BS" | "AD" | null = null;
    const amounts: { x: number; val: string }[] = [];
    const nameParts: { x: number; text: string }[] = [];

    for (const w of row) {
      const conv = devToArabic(w.text);
      if (w.text === "BS" || w.text === "AD") {
        dateType = w.text;
      } else if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(conv)) {
        date = conv;
      } else if (/^[\d,]+\.\d{2}$/.test(conv)) {
        amounts.push({ x: w.x, val: conv });
      } else if (/^\d{1,3}$/.test(conv) && sn === null) {
        sn = conv;
      } else if (/^\d{6,10}$/.test(conv) && pan === null) {
        pan = conv;
      } else if (/^\d+$/.test(conv)) {
        // ignore stray numeric
      } else {
        nameParts.push({ x: w.x, text: w.text });
      }
    }

    if (pan && date && amounts.length === 2) {
      amounts.sort((a, b) => a.x - b.x);
      nameParts.sort((a, b) => a.x - b.x);
      records.push({
        sn: sn ?? "",
        pan,
        nameNepali: nameParts.map((p) => p.text).join(" "),
        nameEnglish: "",
        date,
        dateType: dateType ?? "AD",
        payment: parseAmount(amounts[0].val),
        tds: parseAmount(amounts[1].val),
        headingCode: activeHeading.code,
        headingLabel: activeHeading.label,
        sourceFile,
      });
    }
  }

  if (periodRowIndex >= 0) {
    const before = pureTextRows.filter((r) => r.index < periodRowIndex);
    if (before.length > 0) meta.taxpayerName = before[before.length - 1].text;
  } else if (pureTextRows.length > 0) {
    meta.taxpayerName = pureTextRows[pureTextRows.length - 1].text;
  }

  return { meta, records };
}
