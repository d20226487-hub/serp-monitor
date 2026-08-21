import { describe, expect, it } from "vitest";
import { AnalysisCsvRow, analysisCsvFilename, buildAnalysisCsv } from "@/lib/analysis-csv";
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

function rowsOf(csv: string) {
  return csv.split("\r\n");
}

describe("buildAnalysisCsv", () => {
  it("leads with the decision columns", () => {
    // An export of this table is a shortlist; the score and its rank belong
    // where the eye lands, not after twenty diagnostic fields.
    const header = rowsOf(buildAnalysisCsv([ROW], METRICS, 5, "domain_rating"))[0];
    expect(header.split(",").slice(0, 6)).toEqual([
      "keyword", "opportunity", "opportunity_rank", "volume", "volume_country", "winnability",
    ]);
  });

  it("names the cohort by position and domain", () => {
    const line = rowsOf(buildAnalysisCsv([ROW], METRICS, 5, "domain_rating"))[1];
    expect(line).toContain("#5 #2");
    expect(line).toContain("kzboost-win.org kzboostwin.net");
  });

  it("writes machine-readable numbers, not locale-formatted ones", () => {
    // The display layer groups and uses the viewer's decimal separator; a CSV
    // must not, or the receiving spreadsheet reads text instead of numbers.
    const line = rowsOf(buildAnalysisCsv([ROW], METRICS, 5, "domain_rating"))[1];
    expect(line).toContain(",4.7,");   // float noise trimmed
    expect(line).toContain(",16,");
    expect(line).not.toContain("4,7");
  });

  it("quotes a comment containing commas, quotes and newlines", () => {
    const line = rowsOf(buildAnalysisCsv([ROW], METRICS, 5, "domain_rating"))[1];
    expect(line).toContain('"Media donors, ""PBN"" doorways, commas, and\na newline."');
  });

  it("records how many pages each average actually rested on", () => {
    const partial: AnalysisCsvRow = {
      ...ROW,
      stats: { url_rating: { value: 50, from: 1, of: 2 } },
    };
    const line = rowsOf(buildAnalysisCsv([partial], ["url_rating"], 5, "domain_rating"))[1];
    expect(line).toContain(",50,1,");
  });

  it("leaves an unscored keyword blank rather than zero", () => {
    const unscored: AnalysisCsvRow = { ...ROW, volume: null, score: null, rank: null };
    const line = rowsOf(buildAnalysisCsv([unscored], METRICS, 5, "domain_rating"))[1];
    expect(line.startsWith("boostwin,,,,")).toBe(true);
  });

  it("labels the depth it was exported at", () => {
    expect(rowsOf(buildAnalysisCsv([ROW], METRICS, 5, "domain_rating"))[1]).toContain(",top5,");
    expect(rowsOf(buildAnalysisCsv([ROW], METRICS, 0, "domain_rating"))[1]).toContain(",all,");
  });

  it("emits a header even with no rows", () => {
    expect(rowsOf(buildAnalysisCsv([], METRICS, 5, "domain_rating"))).toHaveLength(1);
  });
});

describe("analysisCsvFilename", () => {
  it("names the run and the depth", () => {
    expect(analysisCsvFilename(66, 5)).toBe("run66_analysis_top5.csv");
    expect(analysisCsvFilename(66, 0)).toBe("run66_analysis_all.csv");
  });
});
