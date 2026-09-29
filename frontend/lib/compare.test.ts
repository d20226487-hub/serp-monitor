import { describe, expect, it } from "vitest";
import { Result, RunQuery } from "@/lib/api";
import {
  byKeyword,
  compareVariants,
  countRows,
  crossDiffers,
  crossTab,
  domainKey,
  engineScopes,
  providerSummaries,
  urlKey,
} from "@/lib/compare";

let nextId = 1;

/** A result row for one provider's SERP. */
function res(
  provider: string,
  position: number,
  url: string,
  over: Partial<Result> = {},
): Result {
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    host = null;
  }
  return {
    id: nextId++,
    keyword: "zazino",
    engine: "google",
    device: "desktop",
    location: "Kazakhstan",
    country_code: "kz",
    language: "ru",
    google_domain: "google.kz",
    position,
    url,
    title: null,
    description: null,
    domain: host,
    provider,
    ...over,
  };
}

/** One query's outcome on one provider. */
function q(
  provider: string,
  status: RunQuery["status"],
  count: number,
  over: Partial<RunQuery> = {},
): RunQuery {
  return {
    provider,
    keyword: "zazino",
    engine: "google",
    device: "desktop",
    location: "Kazakhstan",
    country_code: "kz",
    language: "ru",
    google_domain: "google.kz",
    status,
    result_count: count,
    error: status === "failed" ? "boom" : null,
    ...over,
  };
}

describe("urlKey", () => {
  it("ignores what providers disagree on for the same page", () => {
    const same = [
      "https://www.zazino.online/app/",
      "http://zazino.online/app",
      "https://zazino.online/app#top",
      "HTTPS://WWW.ZAZINO.ONLINE/app/",
    ];
    const keys = new Set(same.map(urlKey));
    expect(keys.size).toBe(1);
  });

  it("keeps what can name a different page", () => {
    expect(urlKey("https://x.kz/App")).not.toBe(urlKey("https://x.kz/app"));
    expect(urlKey("https://x.kz/p?id=1")).not.toBe(urlKey("https://x.kz/p?id=2"));
  });

  it("treats a bare host and the root page as the same URL", () => {
    expect(urlKey("https://zazino.online")).toBe(urlKey("https://zazino.online/"));
  });

  it("returns empty for nothing", () => {
    expect(urlKey(null)).toBe("");
    expect(urlKey("  ")).toBe("");
  });
});

describe("domainKey", () => {
  it("strips www and lower-cases", () => {
    expect(domainKey("WWW.Shazam.com")).toBe("shazam.com");
  });

  it("falls back to the URL's host when no domain was stored", () => {
    expect(domainKey(null, "https://www.vk.ru/zazino")).toBe("vk.ru");
  });
});

describe("engineScopes", () => {
  it("compares each engine only among providers that can run it", () => {
    const scopes = engineScopes(["serpapi", "dataforseo"], [
      q("serpapi", "ok", 3),
      q("dataforseo", "ok", 4),
      q("serpapi", "ok", 10, { engine: "yandex", google_domain: null }),
      q("dataforseo", "unsupported", 0, { engine: "yandex", google_domain: null }),
    ]);
    expect(scopes.map(s => s.engine)).toEqual(["google", "yandex"]);
    expect(scopes[0].providers).toEqual(["serpapi", "dataforseo"]);
    // DataForSEO cannot run Yandex: it is not a column there at all.
    expect(scopes[1].providers).toEqual(["serpapi"]);
  });

  it("keeps a provider whose every request failed out of the comparison", () => {
    const [google] = engineScopes(["a", "b"], [q("a", "ok", 5), q("b", "failed", 0)]);
    expect(google.providers).toEqual(["a", "b"]);
    expect(google.answering).toEqual(["a"]);
  });

  it("totals only over queries every answering provider answered", () => {
    const qs = [
      q("a", "ok", 5), q("b", "ok", 5),
      q("a", "ok", 5, { keyword: "other" }), q("b", "failed", 0, { keyword: "other" }),
    ];
    const [google] = engineScopes(["a", "b"], qs);
    expect(google.variants).toHaveLength(2);
    expect(google.common.size).toBe(1);
  });

  it("counts an empty SERP as answered", () => {
    const [google] = engineScopes(["a", "b"], [q("a", "ok", 5), q("b", "ok", 0)]);
    expect(google.common.size).toBe(1);
  });
});

describe("crossTab", () => {
  it("counts per provider and how many providers found each domain", () => {
    const qs = [q("a", "ok", 2), q("b", "ok", 2)];
    const [scope] = engineScopes(["a", "b"], qs);
    const rows = crossTab([
      res("a", 1, "https://zazino.online/"),
      res("a", 2, "https://vk.ru/zazino"),
      res("b", 1, "https://www.zazino.online/app/"),
      res("b", 2, "https://shazam.com/x"),
    ], scope, "domain");
    const by = Object.fromEntries(rows.map(r => [r.key, r]));
    expect(by["zazino.online"].foundBy).toBe(2);
    expect(by["vk.ru"].foundBy).toBe(1);
    expect(by["vk.ru"].cells.b).toBeUndefined();
    expect(crossDiffers(by["zazino.online"], scope)).toBe(false);
    expect(crossDiffers(by["vk.ru"], scope)).toBe(true);
  });

  it("does not report a failed provider's SERP as missing domains", () => {
    const qs = [
      q("a", "ok", 1), q("b", "ok", 1),
      q("a", "ok", 1, { keyword: "other" }), q("b", "failed", 0, { keyword: "other" }),
    ];
    const [scope] = engineScopes(["a", "b"], qs);
    const rows = crossTab([
      res("a", 1, "https://x.kz/"),
      res("b", 1, "https://x.kz/"),
      // Only "a" answered this query — it must not count against "b".
      res("a", 1, "https://only-a.kz/", { keyword: "other" }),
    ], scope, "domain");
    expect(rows.map(r => r.key)).toEqual(["x.kz"]);
  });

  it("averages positions per provider", () => {
    const qs = [q("a", "ok", 2), q("a", "ok", 2, { keyword: "k2" })];
    const [scope] = engineScopes(["a"], qs);
    const [row] = crossTab([
      res("a", 1, "https://x.kz/"),
      res("a", 5, "https://x.kz/", { keyword: "k2" }),
    ], scope, "domain");
    expect(row.cells.a.count).toBe(2);
    expect(row.cells.a.avgPos).toBe(3);
    expect(row.cells.a.bestPos).toBe(1);
  });
});

describe("countRows", () => {
  it("flags different counts and failures, not agreement", () => {
    const qs = [
      q("a", "ok", 10), q("b", "ok", 10),
      q("a", "ok", 10, { keyword: "k2" }), q("b", "ok", 7, { keyword: "k2" }),
      q("a", "ok", 10, { keyword: "k3" }), q("b", "failed", 0, { keyword: "k3" }),
    ];
    const [scope] = engineScopes(["a", "b"], qs);
    const rows = Object.fromEntries(countRows(scope, qs).map(r => [r.variant.keyword, r]));
    expect(rows.zazino.differs).toBe(false);
    expect(rows.k2.differs).toBe(true);
    expect(rows.k3.differs).toBe(true);
    expect(rows.k3.cells.b.status).toBe("failed");
  });
});

describe("compareVariants", () => {
  it("marks each result against the other providers' SERPs", () => {
    const qs = [q("a", "ok", 3), q("b", "ok", 2)];
    const [scope] = engineScopes(["a", "b"], qs);
    const [v] = compareVariants([
      res("a", 1, "https://zazino.online/app/"),
      res("a", 2, "https://zazino.online/casino"),
      res("a", 3, "https://vk.ru/zazino"),
      res("b", 1, "https://zazino.online/app"),
      res("b", 2, "https://shazam.com/x"),
    ], qs, scope);
    const a = v.columns.find(c => c.provider === "a")!;
    expect(a.rows.map(r => r.mark)).toEqual(["same", "page", "site"]);
    const b = v.columns.find(c => c.provider === "b")!;
    expect(b.rows.map(r => r.mark)).toEqual(["same", "site"]);
    expect(v.diffCount).toBe(3);
    expect(v.depth).toBe(3);
    expect(v.differs).toBe(true);
  });

  it("has nothing to compare against when only one provider answered", () => {
    const qs = [q("a", "ok", 1), q("b", "failed", 0)];
    const [scope] = engineScopes(["a", "b"], qs);
    const [v] = compareVariants([res("a", 1, "https://x.kz/")], qs, scope);
    expect(v.columns[0].rows[0].mark).toBe("solo");
    // No result differs, but the failure itself is a difference worth seeing.
    expect(v.diffCount).toBe(0);
    expect(v.differs).toBe(true);
  });

  it("reads identical SERPs as identical", () => {
    const qs = [q("a", "ok", 1), q("b", "ok", 1)];
    const [scope] = engineScopes(["a", "b"], qs);
    const [v] = compareVariants([
      res("a", 1, "https://www.x.kz/"),
      res("b", 1, "http://x.kz"),
    ], qs, scope);
    expect(v.differs).toBe(false);
  });
});

describe("byKeyword", () => {
  it("groups queries by keyword and counts the differing ones", () => {
    const qs = [
      q("a", "ok", 1), q("b", "ok", 1),
      q("a", "ok", 1, { device: "mobile" }), q("b", "ok", 1, { device: "mobile" }),
    ];
    const [scope] = engineScopes(["a", "b"], qs);
    const kws = byKeyword(compareVariants([
      res("a", 1, "https://x.kz/"), res("b", 1, "https://x.kz/"),
      res("a", 1, "https://x.kz/", { device: "mobile" }),
      res("b", 1, "https://y.kz/", { device: "mobile" }),
    ], qs, scope));
    expect(kws).toHaveLength(1);
    expect(kws[0].variants).toHaveLength(2);
    expect(kws[0].differing).toBe(1);
  });
});

describe("providerSummaries", () => {
  it("tallies each provider's outcomes, results and cost", () => {
    const qs = [
      q("a", "ok", 10), q("b", "ok", 4),
      q("a", "ok", 6, { engine: "yandex", google_domain: null }),
      q("b", "unsupported", 0, { engine: "yandex", google_domain: null }),
    ];
    const [a, b] = providerSummaries(["a", "b"], qs, {
      a: { cost: 0.02, source: "estimate", queries: 2 },
    });
    expect(a).toMatchObject({ ok: 2, failed: 0, unsupported: 0, results: 16, avgResults: 8 });
    expect(a.cost?.cost).toBe(0.02);
    expect(b).toMatchObject({ ok: 1, unsupported: 1, results: 4, avgResults: 4, cost: null });
  });
});
