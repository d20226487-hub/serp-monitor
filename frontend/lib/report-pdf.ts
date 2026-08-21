// Building the run report as a real PDF.
//
// Generated in the BROWSER rather than on the server because everything the
// report says — the opportunity score, the weakest-domain cohort, the slot
// bands — is computed client-side from the analysis payload. A server-side
// renderer would need all of that reimplemented in Python, and the two copies
// would drift.
//
// pdfmake rather than rasterising the DOM: the output is real text you can
// select and search, tables paginate themselves, and the file stays small.
// Its bundled Roboto carries full Cyrillic plus № and the em dash, which the
// Russian report needs and the PDF standard fonts do not have.

import { AnalysisDomain, AnalysisRow, RunAnalysis } from "@/lib/api";
import { OpportunityParts } from "@/lib/opportunity";
import { Band } from "@/lib/serp-strength";

/** One keyword, already reduced to what the report prints. */
export type ReportRow = {
  row: AnalysisRow;
  opp: OpportunityParts;
  bands: Record<Band, number>;
  cohortDr: number | null;
  slots: number;
  domains: AnalysisDomain[];
};

export type ReportStrings = {
  title: string;
  subtitle: string;
  footer: string;
  summary: string;
  stats: [string, string][];
  shortlistTitle: string;
  shortlistLead: string;
  shortlistHead: string[];
  detailTitle: string;
  competitors: string;
  aiComment: string;
  noDomains: string;
  domainHead: string[];
  difficultyLabel: (key: string | null) => string;
  page: (current: number, total: number) => string;
};

const INK = "#111111";
const MUTED = "#666666";
const RULE = "#cccccc";
// Under a year old is the doorway tell the whole age column exists for, so it
// is the one thing in the document that gets colour.
const YOUNG = "#b91c1c";

function fmtNum(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("ru-RU");
}

function fmtAge(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days < 31) return `${days} д`;
  if (days < 365) return `${Math.floor(days / 30)} мес`;
  const y = days / 365.25;
  return y < 10 ? `${y.toFixed(1)} г` : `${y.toFixed(0)} г`;
}

/** Hairline rules only. A PDF full of filled cells prints badly and reads worse. */
const TABLE_LAYOUT = {
  hLineWidth: (i: number, node: any) =>
    i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0.4,
  vLineWidth: () => 0,
  hLineColor: () => RULE,
  paddingTop: () => 4,
  paddingBottom: () => 4,
  paddingLeft: () => 0,
  paddingRight: () => 8,
};

export function buildReportDoc(rows: ReportRow[], s: ReportStrings): any {
  const content: any[] = [
    { text: s.title, style: "h1" },
    { text: s.subtitle, style: "sub" },
    { text: s.footer, style: "meta", margin: [0, 0, 0, 16] },

    { text: s.summary, style: "h2" },
    {
      // Stats as a borderless grid — four labelled numbers, not a table of data.
      columns: s.stats.map(([label, value]) => ({
        stack: [
          { text: label, style: "statLabel" },
          { text: value, style: "statValue" },
        ],
      })),
      columnGap: 12,
      margin: [0, 0, 0, 16],
    },

    { text: s.shortlistTitle, style: "h2" },
    { text: s.shortlistLead, style: "lead" },
    {
      table: {
        headerRows: 1,
        // Measured against Roboto's own metrics at the sizes actually used,
        // taking the wider of each column's header and its widest data value:
        //   Сложность SERP   header 72.0pt, data "очень высокая" 71.8pt -> 74
        //   Потенциал        header 49.3pt, data "31.3" 25.5pt          -> 52
        //   Слабых позиций   wraps; "позиций" 39.7pt                    -> 42
        //   Частотность      header 56.2pt beats "497 000" at 40.6pt    -> 58
        // 278pt fixed of the 515pt usable on A4, leaving 237pt for the keyword,
        // which is ample: the longest keyword here measures under 70pt.
        widths: [18, "*", 58, 74, 34, 42, 52],
        body: [
          s.shortlistHead.map(h => ({ text: h, style: "th" })),
          ...rows.map((v, i) => [
            { text: String(i + 1), style: "tdMuted" },
            { text: v.row.keyword, style: "tdStrong" },
            { text: fmtNum(v.row.volume), style: "tdNum" },
            { text: s.difficultyLabel(v.row.difficulty), style: "td" },
            {
              text: v.cohortDr == null ? "—" : `DR ${v.cohortDr.toFixed(0)}`,
              style: "tdNum",
            },
            { text: `${v.bands.soft}/${v.slots}`, style: "tdNum" },
            { text: (v.opp.score ?? 0).toFixed(1), style: "tdNumStrong" },
          ]),
        ],
      },
      layout: TABLE_LAYOUT,
      margin: [0, 0, 0, 18],
    },

    { text: s.detailTitle, style: "h2", pageBreak: "before" },
  ];

  for (const v of rows) {
    const block: any[] = [
      {
        columns: [
          { text: v.row.keyword, style: "h3" },
          {
            text: (v.opp.score ?? 0).toFixed(1),
            style: "h3",
            alignment: "right",
            width: 40,
          },
        ],
      },
      {
        text: `${fmtNum(v.row.volume)} · ${s.difficultyLabel(v.row.difficulty)}`,
        style: "meta",
        margin: [0, 0, 0, 6],
      },
    ];

    if (v.row.comment) {
      block.push({ text: s.aiComment, style: "caption" });
      block.push({ text: v.row.comment, style: "body", margin: [0, 0, 0, 6] });
    }

    block.push({ text: s.competitors, style: "caption" });
    if (v.domains.length === 0) {
      block.push({ text: s.noDomains, style: "metaSmall" });
    } else {
      block.push({
        table: {
          headerRows: 1,
          // Six columns, sized on measured widths: the widest data is a
          // youtube-scale "58 001 219" at 52.9pt, and the Russian headers wrap
          // to two lines within 54-56pt. 258pt fixed leaves 257pt for the
          // domain, which takes the longest doorway names at 183pt.
          widths: ["*", 40, 54, 56, 54, 54],
          body: [
            s.domainHead.map(h => ({ text: h, style: "th" })),
            ...v.domains.map(d => [
              { text: d.domain, style: "tdMono" },
              {
                text: fmtAge(d.age_days),
                style: "tdNum",
                color: d.age_days != null && d.age_days < 365 ? YOUNG : INK,
                bold: d.age_days != null && d.age_days < 365,
              },
              { text: fmtNum(d.metrics.backlinks_dofollow), style: "tdNum" },
              { text: fmtNum(d.metrics.refdomains_dofollow), style: "tdNum" },
              { text: fmtNum(d.metrics.org_keywords_1_3), style: "tdNum" },
              { text: fmtNum(d.metrics.org_keywords_4_10), style: "tdNum" },
            ]),
          ],
        },
        layout: TABLE_LAYOUT,
      });
    }

    content.push({
      stack: block,
      margin: [0, 0, 0, 14],
      // A verdict separated from the competitors that justify it is the one
      // split this document cannot afford, so each keyword stays whole.
      unbreakable: true,
    });
  }

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 44],
    defaultStyle: { font: "Roboto", fontSize: 9, color: INK, lineHeight: 1.25 },
    footer: (current: number, total: number) => ({
      text: s.page(current, total),
      style: "pageNo",
      alignment: "right",
      margin: [0, 12, 40, 0],
    }),
    content,
    styles: {
      h1: { fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
      h2: { fontSize: 13, bold: true, margin: [0, 8, 0, 6] },
      h3: { fontSize: 11, bold: true },
      sub: { fontSize: 10, color: MUTED },
      meta: { fontSize: 9, color: MUTED },
      metaSmall: { fontSize: 8, color: MUTED },
      lead: { fontSize: 9, color: MUTED, margin: [0, 0, 0, 6] },
      caption: { fontSize: 8, color: MUTED, margin: [0, 2, 0, 2] },
      body: { fontSize: 9 },
      th: { fontSize: 8, bold: true, color: MUTED },
      td: { fontSize: 9 },
      tdStrong: { fontSize: 9, bold: true },
      tdMuted: { fontSize: 9, color: MUTED },
      tdMono: { fontSize: 8 },
      tdNum: { fontSize: 9, alignment: "right" },
      tdNumStrong: { fontSize: 9, alignment: "right", bold: true },
      statLabel: { fontSize: 8, color: MUTED },
      statValue: { fontSize: 15, bold: true },
      pageNo: { fontSize: 8, color: MUTED },
    },
  };
}

/**
 * Build and hand the file to the browser.
 *
 * pdfmake and its embedded fonts are ~1MB, so they load only when a download
 * is actually asked for rather than on every visit to the run page.
 */
export async function downloadReportPdf(
  rows: ReportRow[],
  strings: ReportStrings,
  filename: string,
): Promise<void> {
  const [{ default: pdfMake }, vfs] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  // pdfmake 0.3 ships the vfs as a bare module export, and older builds nested
  // it under pdfMake.vfs — accept either rather than depend on the packaging.
  const mod: any = (vfs as any).default ?? vfs;
  // The module exports the table directly in 0.3; older builds nested it under
  // pdfMake.vfs. Accept either rather than depend on the packaging.
  const table = mod.pdfMake?.vfs ?? mod.vfs ?? mod;

  const mk: any = pdfMake;
  // 0.3 registers fonts through addVirtualFileSystem and already declares
  // Roboto itself. Assigning `.vfs` is the 0.2 API and silently does nothing —
  // which surfaces later as "Roboto-Medium.ttf not found in virtual file
  // system" at render time rather than at setup.
  if (typeof mk.addVirtualFileSystem === "function") {
    mk.addVirtualFileSystem(table);
  } else {
    mk.vfs = table;
  }
  mk.createPdf(buildReportDoc(rows, strings)).download(filename);
}
