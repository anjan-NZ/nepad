import { strFromU8, unzipSync } from "fflate";
import { parseTdsLines } from "./parseLines";
import { TdsParseResult } from "./types";

export function isZipFormat(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

interface ManifestPage {
  page_number: number;
  text: { path: string };
}
interface Manifest {
  pages: ManifestPage[];
}

export function parseTdsZip(bytes: Uint8Array, sourceFile: string): TdsParseResult {
  const files = unzipSync(bytes);
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) {
    throw new Error("ZIP-format TDS file is missing manifest.json");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as Manifest;
  const pages = [...manifest.pages].sort((a, b) => a.page_number - b.page_number);

  const lines: string[] = [];
  for (const p of pages) {
    const textBytes = files[p.text.path];
    if (!textBytes) continue;
    lines.push(...strFromU8(textBytes).split(/\r?\n/));
  }

  return parseTdsLines(lines, sourceFile, "zip-pdf");
}
