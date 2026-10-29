import { describe, expect, it } from "vitest";
import type { TrackingRow, TrackingSerp } from "@/lib/api";
import { EVERYTHING, bandOf, bandStart, exportRows, toCsv, trackingTable } from "@/lib/tracking-export";

const TOPS = [1, 3, 5, 10, 20, 30, 50, 100];
const SERP: TrackingSerp = {
  engine: "google", device: "mobile", country_code: "kz", language: "ru", location: null, google_domain: "google.kz",
  key: "kz", keywords: 1, depth: 10, now: {}, before: null, before_check: null, keywords_best: [],
};
const at = (position: number | null, iso = "2026-10-28T07:00:00") => ({ at: iso, position });

function row(over: Partial<TrackingRow>): TrackingRow {
  return {
    serp: "kz", keyword: "casino", cluster: null, url: "https://site-one.example/", domain: "site-one.example", amp_of: null,
    position: 3, checked_at: "2026-10-29T07:00:00", best: 3, average: 3, position_sum: 3, checks: 1, ranked_in: 1, readings: [],
    previous_check: null, previous_period: null, ...over,
  };
}

describe("bands", () => {
  it("a top stands for the places after the top before it", () => {
    expect([1, 2, 3, 4, 6, 10, 11, 51, 100].map(p => bandOf(p, TOPS))).toEqual([1, 3, 3, 5, 10, 10, 20, 100, 100]);
    expect(bandOf(null, TOPS)).toBe("none");
    expect(bandOf(140, TOPS)).toBeNull();
    expect([1, 3, 5, 10, 100].map(n => bandStart(n, TOPS))).toEqual([1, 2, 4, 6, 51]);
  });
});

describe("exportRows", () => {
  const rows = [
    row({ keyword: "a", position: 1, previous_check: at(1) }),
    row({ keyword: "b", position: 7, previous_check: at(9) }),
    row({ keyword: "c", position: null, best: null, previous_check: at(4) }),
    row({ keyword: "d", serp: "kg", position: 2 }),
  ];
  const keywords = (rs: TrackingRow[]) => rs.map(r => r.keyword);

  it("everything the table can show, whatever its filters", () => {
    expect(keywords(exportRows(rows, EVERYTHING, "check", TOPS))).toEqual(["a", "b", "c", "d"]);
  });

  it("several bands at once: #1 and #6–10", () => {
    expect(keywords(exportRows(rows, { ...EVERYTHING, bands: [1, 10] }, "check", TOPS))).toEqual(["a", "b"]);
    expect(keywords(exportRows(rows, { ...EVERYTHING, bands: ["none"] }, "check", TOPS))).toEqual(["c"]);
  });

  it("by cluster, and keywords without one", () => {
    const clustered = [row({ keyword: "a", cluster: "Brand" }), row({ keyword: "b", cluster: null })];
    expect(keywords(exportRows(clustered, { ...EVERYTHING, clusters: ["Brand"] }, "check", TOPS))).toEqual(["a"]);
    expect(keywords(exportRows(clustered, { ...EVERYTHING, clusters: [""] }, "check", TOPS))).toEqual(["b"]);
  });

  it("by SERP and by change", () => {
    expect(keywords(exportRows(rows, { ...EVERYTHING, serps: ["kg"] }, "check", TOPS))).toEqual(["d"]);
    expect(keywords(exportRows(rows, { ...EVERYTHING, changes: ["up", "lost"] }, "check", TOPS))).toEqual(["b", "c"]);
  });
});

describe("the file", () => {
  const words = {
    head: ["keyword", "url", "domain", "geo", "engine", "latest", "best", "avg", "change", "was", "kind"],
    engine: (e: string) => e.toUpperCase(),
    kind: (k: string) => k,
  };

  it("the table's own columns and the domain — nothing more", () => {
    const r = row({
      position: 2, average: 2.5, ranked_in: 2, checks: 2, previous_check: at(5), amp_of: "site-two.example",
      readings: [at(3, "2026-10-28T07:00:00"), at(2, "2026-10-29T07:00:00")],
    });
    const [head, line] = trackingTable([r], "ru", "check", () => SERP, words);
    expect(head).toEqual(words.head);
    expect(line).toEqual(["casino", "https://site-one.example/", "site-one.example", "KZ", "GOOGLE", "2", "3", "2,5", "+3", "5", "up"]);
  });

  it("was: a dash when not on that page, empty when there was no such check", () => {
    const [, isNew] = trackingTable([row({ previous_check: at(null) })], "ru", "check", () => SERP, words);
    const [, unmatched] = trackingTable([row({})], "ru", "check", () => SERP, words);
    expect([isNew[9], isNew[10]]).toEqual(["—", "new"]);
    expect([unmatched[9], unmatched[10]]).toEqual(["", "none"]);
  });

  it("the cluster follows the keyword, only for a project with clusters", () => {
    const [head, line] = trackingTable([row({ cluster: "Brand" })], "ru", "check", () => SERP, { ...words, clusterHead: "cluster" });
    expect([head[0], head[1], head[2]]).toEqual(["keyword", "cluster", "url"]);
    expect([line[0], line[1], line[2]]).toEqual(["casino", "Brand", "https://site-one.example/"]);
    const [noHead] = trackingTable([row({ cluster: "Brand" })], "ru", "check", () => SERP, words);
    expect(noHead[1]).toBe("url");
  });

  it("Excel's way in each language: BOM, the separator, quotes where needed", () => {
    expect(toCsv([["a", "b;c"], ["1,5", "x"]], "ru")).toBe('\uFEFFa;"b;c"\r\n"1,5";x\r\n');
    expect(toCsv([["a", 'say "hi"']], "en")).toBe('\uFEFFa,"say ""hi"""\r\n');
  });
});
