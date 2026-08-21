import { describe, expect, it } from "vitest";
import {
  AnalysisCsvContext,
  AnalysisCsvRow,
  CsvColumnOverrides,
  analysisCsvColumns,
  analysisCsvFilename,
  buildAnalysisCsv,
  isColumnOn,
  metricColumnId,
  pagesAveragedColumnId,
  pruneOverrides,
  selectedAnalysisCsvColumns,
} from "@/lib/analysis-csv";
import { AnalysisUrl } from "@/lib/api";

function page(position: number, domain: string): AnalysisUrl {
  return {
    url: `https://${domain}/`,
    analyzed_url: `https://${domain}/`,
    normalized: false,
    position,
    positions: [position],
    domain,
    metrics: {},
    error: false,
    analysed: true,
  };
}

const ROW: AnalysisCsvRow = {
  keyword: "boostwin",
  volume: 20000,
  volumeCountry: "kz",
  score: 55.0553,
  rank: 1,
  winnability: 0.525,
  cohort: [page(5, "kzboost-win.org"), page(2, "kzboostwin.net")],
  stats: {
    url_rating: { value: 4.699999999999999, from: 2, of: 2 },
    domain_rating: { value: 16, from: 2, of: 2 },
  },
  bands: { soft: 2, propped: 1, moderate: 2, strong: 0, unknown: 0 },
  analysed: 5,
  total: 5,
  difficulty: "medium",
  comment: 'Media donors, "PBN" doorways, commas, and\na newline.',
};

const METRICS = ["url_rating", "domain_rating"];
const CTX: AnalysisCsvContext = { depth: 5, ranker: "domain_rating" };

/** Everything ticked — the old, fixed export. */
const ALL: CsvColumnOverrides = Object.fromEntries(
  analysisCsvColumns(METRICS).map(c => [c.id, true]),
);

function csv(
  rows: AnalysisCsvRow[],
  overrides: CsvColumnOverrides = ALL,
  ctx: AnalysisCsvContext = CTX,
  metrics: string[] = METRICS,
) {
  return buildAnalysisCsv(
    rows, selectedAnalysisCsvColumns(metrics, overrides), ctx,
  ).split("\r\n");
}

describe("buildAnalysisCsv", () => {
  it("opens the way the analyzer table does", () => {
    // The export is read next to the table it came from, so it reads left to
    // right the same way: keyword, volume, then the entry bar.
    expect(csv([ROW])[0].split(",").slice(0, 5)).toEqual([
      "Keyword", "Volume", "Volume country", "UR", "DR",
    ]);
  });

  it("puts the AI comment last", () => {
    // A paragraph of prose mid-row makes every column after it unreadable in
    // a spreadsheet.
    const header = csv([ROW])[0].split(",");
    expect(header[header.length - 1]).toBe("AI comment");
  });

  it("names the cohort by position and domain", () => {
    const line = csv([ROW])[1];
    expect(line).toContain("#5 #2");
    expect(line).toContain("kzboost-win.org kzboostwin.net");
  });

  it("writes machine-readable numbers, not locale-formatted ones", () => {
    // The display layer groups and uses the viewer's decimal separator; a CSV
    // must not, or the receiving spreadsheet reads text instead of numbers.
    const line = csv([ROW])[1];
    expect(line).toContain(",4.7,");   // float noise trimmed
    expect(line).toContain(",16,");
    expect(line).not.toContain("4,7");
  });

  it("quotes a comment containing commas, quotes and newlines", () => {
    expect(csv([ROW])[1]).toContain(
      '"Media donors, ""PBN"" doorways, commas, and\na newline."',
    );
  });

  it("records how many pages each average actually rested on", () => {
    const partial: AnalysisCsvRow = {
      ...ROW,
      stats: { url_rating: { value: 50, from: 1, of: 2 } },
    };
    const [header, line] = csv([partial], ALL, CTX, ["url_rating"]);
    expect(header).toContain("UR,UR pages averaged");
    expect(line).toContain(",50,1,");
  });

  it("names its columns the way a spreadsheet reader does", () => {
    // Nobody opening this in Excel knows what refdomains_dofollow is.
    const header = csv([ROW], ALL, CTX,
      ["url_rating", "refdomains_dofollow"])[0].split(",");
    expect(header).toContain("Referring domains (follow)");
    expect(header).toContain("weak pages");
    expect(header).toContain("pages_total");
    expect(header).toContain("SERP difficulty");
    // Not one snake_case field name left anywhere in the row.
    expect(header.filter(h => /^[a-z0-9]+_[a-z0-9_]+$/.test(h)))
      .toEqual(["pages_analysed", "pages_total"]);
  });

  it("prints the score at the precision the table shows", () => {
    // 55.0553 on screen is 55.1; the sheet must not disagree with it.
    const cells = csv([ROW])[1].split(",");
    const at = csv([ROW])[0].split(",").indexOf("Opportunity");
    expect(cells[at]).toBe("55.1");
  });

  it("keeps the rows in the order they were handed over", () => {
    // Rounding invents ties the raw score does not have. The file is written in
    // the table's order so the row that ranked higher stays higher, whatever
    // the printed value says.
    const a: AnalysisCsvRow = { ...ROW, keyword: "higher", score: 12.8127, rank: 1 };
    const b: AnalysisCsvRow = { ...ROW, keyword: "lower", score: 12.8054, rank: 2 };
    const [, first, second] = csv([a, b]);
    expect(first.startsWith("higher,")).toBe(true);
    expect(second.startsWith("lower,")).toBe(true);
    // Both print the same score — only the order and the rank tell them apart.
    const at = csv([a, b])[0].split(",").indexOf("Opportunity");
    expect(first.split(",")[at]).toBe("12.8");
    expect(second.split(",")[at]).toBe("12.8");
  });

  it("leaves an unscored keyword blank rather than zero", () => {
    const unscored: AnalysisCsvRow = { ...ROW, volume: null, score: null, rank: null };
    // keyword, then empty volume; the score sits later and is empty too.
    const cells = csv([unscored])[1].split(",");
    expect(cells[0]).toBe("boostwin");
    expect(cells[1]).toBe("");
    expect(csv([unscored])[0].split(",").map((h, i) => [h, cells[i]])
      .filter(([h]) => h === "Opportunity" || h === "Opportunity rank"))
      .toEqual([["Opportunity", ""], ["Opportunity rank", ""]]);
  });

  it("labels the depth it was exported at", () => {
    expect(csv([ROW])[1]).toContain(",top5,");
    expect(csv([ROW], ALL, { ...CTX, depth: 0 })[1]).toContain(",all,");
  });

  it("emits a header even with no rows", () => {
    expect(csv([])).toHaveLength(1);
  });

  it("writes only the chosen columns, in the canonical order", () => {
    // Deliberately asked for in a scrambled order: selecting columns must not
    // let the caller reshuffle the file.
    const only: CsvColumnOverrides = Object.fromEntries(
      analysisCsvColumns(METRICS)
        .map(c => [c.id, ["ai_comment", "keyword", "opportunity"].includes(c.id)]),
    );
    const [header, line] = csv([ROW], only);
    expect(header).toBe("Keyword,Opportunity,AI comment");
    expect(line.startsWith("boostwin,55.1,")).toBe(true);
  });

  it("still writes a header when every column is unticked", () => {
    const none: CsvColumnOverrides = Object.fromEntries(
      analysisCsvColumns(METRICS).map(c => [c.id, false]),
    );
    expect(csv([ROW], none)).toEqual(["", ""]);
  });
});

describe("default columns", () => {
  const defaults = selectedAnalysisCsvColumns(METRICS, {}).map(c => c.header);

  it("exports the analyzer table's own columns, in its own order", () => {
    expect(defaults).toEqual([
      "Keyword",
      "Volume",
      "UR",
      "DR",
      "weak pages",
      "pages_total",
      "SERP difficulty",
      "Opportunity",
      "AI comment",
    ]);
  });

  it("leaves the SERP shape out — a ladder has no CSV form", () => {
    for (const h of ["Cohort size", "Cohort ranked by", "Cohort positions", "Cohort domains", "Depth"]) {
      expect(defaults).not.toContain(h);
    }
  });

  it("defaults to each metric's average, not the count of pages behind it", () => {
    // The two are one row apart in the picker and a short label on either is
    // read as the other; the CSV must never quietly carry "2, 2, 2" where the
    // table shows a rating.
    expect(defaults).toContain("UR");
    expect(defaults).not.toContain("UR pages averaged");
  });

  it("exports a metric a later run adds, without re-ticking it", () => {
    // The whole reason the selection is stored as overrides: a run that starts
    // collecting backlinks must not silently drop the column.
    const chose: CsvColumnOverrides = { winnability: true, ai_comment: false };
    const headers = selectedAnalysisCsvColumns([...METRICS, "backlinks"], chose)
      .map(c => c.header);
    expect(headers).toContain("Backlinks");
    expect(headers).toContain("Winnability");
    expect(headers).not.toContain("AI comment");
  });
});

describe("isColumnOn", () => {
  const cols = analysisCsvColumns(METRICS);
  const find = (id: string) => cols.find(c => c.id === id)!;

  it("follows the default until the column is touched", () => {
    expect(isColumnOn(find("keyword"), {})).toBe(true);
    expect(isColumnOn(find("winnability"), {})).toBe(false);
    expect(isColumnOn(find("winnability"), { winnability: true })).toBe(true);
    expect(isColumnOn(find("keyword"), { keyword: false })).toBe(false);
  });

  it("keeps a metric's value and its page count apart", () => {
    expect(isColumnOn(find(metricColumnId("url_rating")), {})).toBe(true);
    expect(isColumnOn(find(pagesAveragedColumnId("url_rating")), {})).toBe(false);
  });
});

describe("pruneOverrides", () => {
  it("drops a choice that only restates the default", () => {
    expect(pruneOverrides(METRICS, { keyword: true, winnability: false })).toEqual({});
  });

  it("keeps a real deviation", () => {
    expect(pruneOverrides(METRICS, { keyword: false, winnability: true }))
      .toEqual({ keyword: false, winnability: true });
  });

  it("keeps a choice about a metric this run did not collect", () => {
    // Otherwise switching to a run without backlinks would forget that the
    // user had turned that column on.
    const kept = pruneOverrides(METRICS, { [metricColumnId("backlinks")]: false });
    expect(kept).toEqual({ [metricColumnId("backlinks")]: false });
  });
});

describe("analysisCsvFilename", () => {
  it("names the run and the depth", () => {
    expect(analysisCsvFilename(66, 5)).toBe("run66_analysis_top5.csv");
    expect(analysisCsvFilename(66, 0)).toBe("run66_analysis_all.csv");
  });
});
