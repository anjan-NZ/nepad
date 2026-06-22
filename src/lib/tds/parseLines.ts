import { devToArabic, parseAmount } from "./digits";
import { TdsFileMeta, TdsParseResult, TdsRecord } from "./types";

const SECTION_CODE_RE = /\b(1\d{4})\b/;
const HEADER_ANCHORS = [
  "ककशसम",
  "शशरकर",
  "Individual",
  "Private",
  "Public",
  "Remuneration",
  "Social",
  "Proprietorship",
  "Tax",
];
const VOUCHER_RE = /भभचर\s*वससरण/;
const PERIOD_RE = /(\d{4}\.\d{2}\.\d{2})\s+\S+\s+(\d{4}\.\d{2}\.\d{2})/;
const ALL_DATES_RE = /\d{4}\.\d{1,2}\.\d{1,2}/g;
const SUBNO_RE = /\b(\d{13,15})\b/;
const DATA_ROW_RE =
  /^(.+?)\s+(\d{9,10})\s+(\d{4}\.\d{2}\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\d+)\s+(AD|BS)$/;
const DATA_ONLY_RE =
  /^(\d{9,10})\s+(\d{4}\.\d{2}\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\d+)\s+(AD|BS)$/;
const SKIP_TEXT_KW = [
  "जममप",
  "रकम :",
  "शस. न.",
  "सरपयय",
  "लनखप नम",
  "ननपप",
  "आनन",
  "अर म",
  "ननसन",
  "फकन :",
  "इ-मन",
  "रजज ल",
  "रदकर",
  "शमनन",
  "भभकन",
];

function isSectionHeader(line: string, discovered: Map<string, string>): string | null {
  const m = SECTION_CODE_RE.exec(line);
  if (!m) return null;
  if (!HEADER_ANCHORS.some((kw) => line.includes(kw))) return null;

  const code = m[1];
  let label = "";
  if (line.includes(":")) {
    const parts = line.split(":");
    label = parts[parts.length - 1].trim();
  } else {
    label = line.slice(m.index + m[0].length).trim();
  }
  if (label && !discovered.has(code)) discovered.set(code, label);
  return code;
}

export function parseTdsLines(
  lines: string[],
  sourceFile: string,
  format: "zip-pdf" | "html",
): TdsParseResult {
  const meta: TdsFileMeta = {
    sourceFile,
    taxpayerName: "",
    pan: "",
    periodFrom: "",
    periodTo: "",
    submissionNo: "",
    recordVerifiedDate: "",
    format,
  };
  const records: TdsRecord[] = [];
  const discovered = new Map<string, string>();
  let currentCode: string | null = null;
  let inVoucher = false;
  let pendingName = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const t = devToArabic(line);

    if ((line.includes("ददखख") || line.includes("देखि")) && !meta.periodFrom) {
      const m = PERIOD_RE.exec(t);
      if (m) {
        meta.periodFrom = m[1];
        meta.periodTo = m[2];
        const allDates = [...t.matchAll(ALL_DATES_RE)].map((d) => d[0]);
        if (allDates.length >= 3) meta.recordVerifiedDate = allDates[2];
      }
    }
    if (!meta.submissionNo) {
      const m = SUBNO_RE.exec(t);
      if (m) meta.submissionNo = m[1];
    }

    if (VOUCHER_RE.test(line)) {
      inVoucher = true;
      pendingName = "";
      continue;
    }
    if (inVoucher) continue;

    const code = isSectionHeader(line, discovered);
    if (code) {
      currentCode = code;
      pendingName = "";
      continue;
    }

    if (SKIP_TEXT_KW.some((kw) => line.includes(kw))) {
      pendingName = "";
      continue;
    }

    if (!currentCode) continue;

    const translated = devToArabic(line);

    let m = DATA_ROW_RE.exec(translated);
    if (m) {
      let vendor = m[1].trim();
      if (pendingName) {
        vendor = `${pendingName} ${vendor}`.trim();
        pendingName = "";
      }
      records.push({
        sn: m[6],
        pan: m[2],
        nameNepali: vendor,
        nameEnglish: "",
        date: m[3],
        dateType: m[7] as "AD" | "BS",
        payment: parseAmount(m[4]),
        tds: parseAmount(m[5]),
        headingCode: currentCode,
        headingLabel: discovered.get(currentCode) ?? currentCode,
        sourceFile,
      });
      continue;
    }

    m = DATA_ONLY_RE.exec(translated);
    if (m) {
      records.push({
        sn: m[5],
        pan: m[1],
        nameNepali: pendingName.trim(),
        nameEnglish: "",
        date: m[2],
        dateType: m[6] as "AD" | "BS",
        payment: parseAmount(m[3]),
        tds: parseAmount(m[4]),
        headingCode: currentCode,
        headingLabel: discovered.get(currentCode) ?? currentCode,
        sourceFile,
      });
      pendingName = "";
      continue;
    }

    if (/[ऀ-ॿ]/.test(line) && !line.endsWith("AD") && !line.endsWith("BS")) {
      pendingName = pendingName ? `${pendingName} ${line}` : line;
    } else {
      pendingName = "";
    }
  }

  return { meta, records };
}
