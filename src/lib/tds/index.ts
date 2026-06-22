import { parseTdsHtml } from "./parseHtml";
import { parseTdsPdf } from "./parsePdf";
import { isZipFormat, parseTdsZip } from "./parseZip";

export * from "./types";

export async function parseTdsFile(bytes: Uint8Array, sourceFile: string) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return parseTdsPdf(bytes, sourceFile); // "%PDF"
  }
  if (isZipFormat(bytes)) {
    return parseTdsZip(bytes, sourceFile);
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return parseTdsHtml(text, sourceFile);
}
