// Ahrefs metric ids as they read in a column header.
//
// Lifted out of the analyzer table once the CSV column picker needed the same
// names: a picker that offered "refdomains_dofollow" while the table above it
// said "Ref domains (follow)" would read as two different columns.
//
// Deliberately untranslated. These are Ahrefs' own column names and an SEO
// reads them as UR and DR whatever language the rest of the page is in.

export const METRIC_LABELS: Record<string, string> = {
  url_rating: "UR",
  domain_rating: "DR",
  backlinks: "Backlinks",
  backlinks_dofollow: "Backlinks (follow)",
  refdomains: "Ref domains",
  refdomains_dofollow: "Ref domains (follow)",
  org_traffic: "Org. traffic",
  org_keywords: "Org. keywords",
  org_keywords_1_3: "Org. kw 1-3",
  org_keywords_4_10: "Org. kw 4-10",
  org_keywords_11_20: "Org. kw 11-20",
  refdomains_nofollow: "Ref domains (nofollow)",
  refips_subnets: "Ref IP subnets",
  ahrefs_rank: "Ahrefs Rank",
};

/** Header label for a metric, falling back to the raw id — Ahrefs can return a
 *  field we have not named yet, and an unnamed column still beats a blank one. */
export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
}

/**
 * The same metrics as a CSV header.
 *
 * Spelled out where the table abbreviates: a table column is fighting for
 * width against eleven neighbours, a spreadsheet column is not, and
 * "refdomains_dofollow" tells a reader opening the file in Excel nothing at
 * all. UR and DR stay short because that is what they are called.
 */
export const METRIC_CSV_HEADERS: Record<string, string> = {
  url_rating: "UR",
  domain_rating: "DR",
  backlinks: "Backlinks",
  backlinks_dofollow: "Backlinks (follow)",
  refdomains: "Referring domains",
  refdomains_dofollow: "Referring domains (follow)",
  refdomains_nofollow: "Referring domains (nofollow)",
  org_traffic: "Organic traffic",
  org_keywords: "Organic keywords",
  org_keywords_1_3: "Organic keywords 1-3",
  org_keywords_4_10: "Organic keywords 4-10",
  org_keywords_11_20: "Organic keywords 11-20",
  refips_subnets: "Referring IP subnets",
  ahrefs_rank: "Ahrefs Rank",
};

export function metricCsvHeader(metric: string): string {
  return METRIC_CSV_HEADERS[metric] ?? metric;
}
