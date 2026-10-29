// Keywords added in bulk to a project — pasted, or from a CSV file — each with
// an optional cluster (user, 2026-10-29: "Let the user bulk add keywords by
// bulk pasting or uploading CSV file … Plus let the user add the cluster next
// to the keyword (keyword, cluster)").

/** One keyword to add. `cluster` undefined: none was given, so a keyword the
 *  project has keeps its own; "": given empty, which takes it away. */
export type KeywordLine = { keyword: string; cluster?: string };

/** Without spaces, commas or semicolons at either end: copied from a sheet,
 *  "casino online," and a cluster in the next column came in as the
 *  keyword "casino online," — a keyword the project did not have. */
export function trimSeparators(text: string): string {
  return text.replace(/^[\s,;]+|[\s,;]+$/g, "");
}

/**
 * Pasted lines: "keyword", or "keyword" and its cluster after a Tab (what a
 * copy from a spreadsheet gives), a ";" or a "," — the first of those the line
 * has, in that order, so a cluster may itself hold a comma after a Tab.
 */
export function parsePasted(text: string): KeywordLine[] {
  const out: KeywordLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : line.includes(",") ? "," : null;
    if (sep === null) {
      out.push({ keyword: line });
      continue;
    }
    const at = line.indexOf(sep);
    const keyword = trimSeparators(line.slice(0, at));
    if (keyword) out.push({ keyword, cluster: trimSeparators(line.slice(at + 1)) });
  }
  return out;
}

/** CSV rows, quotes and all, with the given separator. */
export function csvRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const KEYWORD_HEADS = ["keyword", "keywords", "query", "queries", "запрос", "запросы", "ключевое слово", "ключевые слова", "фраза"];
const CLUSTER_HEADS = ["cluster", "clusters", "group", "кластер", "кластеры", "группа"];

/**
 * A CSV file: the keyword in the first column, the cluster in the second —
 * or wherever a header row names them ("Запрос", "Кластер", "Keyword",
 * "Cluster" …). The separator is the one the first line uses most: ";", ","
 * or a Tab. A file of one column is keywords alone.
 */
export function parseKeywordFile(text: string): KeywordLine[] {
  const body = text.replace(/^﻿/, "");
  const first = body.split(/\r?\n/, 1)[0] ?? "";
  const count = (s: string) => first.split(s).length - 1;
  const sep = [";", ",", "\t"].reduce((best, s) => (count(s) > count(best) ? s : best), ";");
  const rows = csvRows(body, sep).map(r => r.map(c => c.trim())).filter(r => r.some(Boolean));
  if (rows.length === 0) return [];
  let kwAt = 0;
  let clusterAt: number | null = rows[0].length > 1 ? 1 : null;
  const head = rows[0].map(c => c.toLowerCase());
  if (KEYWORD_HEADS.includes(head[0]) || head.some(c => CLUSTER_HEADS.includes(c))) {
    kwAt = Math.max(0, head.findIndex(c => KEYWORD_HEADS.includes(c)));
    const at = head.findIndex(c => CLUSTER_HEADS.includes(c));
    clusterAt = at >= 0 ? at : null;
    rows.shift();
  }
  const out: KeywordLine[] = [];
  for (const r of rows) {
    const keyword = trimSeparators(r[kwAt] ?? "");
    if (!keyword) continue;
    out.push(clusterAt === null ? { keyword } : { keyword, cluster: trimSeparators(r[clusterAt] ?? "") });
  }
  return out;
}
