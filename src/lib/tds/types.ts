export interface TdsRecord {
  sn: string;
  pan: string;
  nameNepali: string;
  nameEnglish: string;
  date: string;
  dateType: "BS" | "AD";
  payment: number;
  tds: number;
  headingCode: string;
  headingLabel: string;
  sourceFile: string;
}

export interface TdsFileMeta {
  sourceFile: string;
  taxpayerName: string;
  pan: string;
  periodFrom: string;
  periodTo: string;
  submissionNo: string;
  recordVerifiedDate: string;
  format: "pdf" | "zip-pdf" | "html";
}

export interface TdsParseResult {
  meta: TdsFileMeta;
  records: TdsRecord[];
}
