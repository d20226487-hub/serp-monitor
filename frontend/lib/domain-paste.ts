// Turning a pasted block of domains into a clean host list.
//
// Mirrors backend/app/providers/domain_paste.py, and exists so the form can
// show what will be saved BEFORE saving it. The server normalises again on the
// way in — it is the one that has to be right — but a paste of forty domains
// where three were silently dropped is exactly the mistake worth catching
// while the textarea is still open.
//
// Normalisation matches what the SERP side does, because these hosts will be
// compared against result URLs: lowercase, scheme and path removed, leading
// "www." dropped. Subdomains are KEPT: kz.example.com and example.com are
// different targets and position tracking has to tell them apart.

/** Anything that cannot appear inside a host. Tabs and newlines are the
 *  spreadsheet cases; commas and semicolons the copied-from-an-email ones. */
const SEPARATORS = /[\s,;|]+/;

/** Labels joined by dots. Deliberately permissive about the TLD — new gTLDs
 *  keep appearing, and rejecting an unknown one would drop exactly the doorway
 *  domains this tool exists to watch. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** One pasted token as a bare host, or null when it is not one. */
export function normalizeDomain(raw: string): string | null {
  let s = (raw || "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!s) return null;
  // A URL, or a host with a path glued on: keep what comes before the slash.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split("/")[0];
  // Credentials and port are not part of the identity we compare on.
  s = s.split("@").pop() ?? s;
  s = s.split(":")[0];
  if (s.startsWith("www.")) s = s.slice(4);
  // A trailing dot is a legal FQDN; an internal empty label is not.
  s = s.replace(/^\.+|\.+$/g, "");
  return HOST.test(s) ? s : null;
}

export type DomainParse = {
  /** Clean hosts, in the order pasted, first occurrence winning. */
  domains: string[];
  /** Tokens that are not hosts. Reported rather than dropped in silence. */
  rejected: string[];
  /** Repeats collapsed — the same host under two spellings counts here. */
  duplicates: number;
};

export function parseDomains(text: string): DomainParse {
  const seen = new Set<string>();
  const domains: string[] = [];
  const rejected: string[] = [];
  let duplicates = 0;
  for (const token of (text || "").split(SEPARATORS)) {
    if (!token.trim()) continue;
    const host = normalizeDomain(token);
    if (host == null) {
      rejected.push(token.trim());
      continue;
    }
    if (seen.has(host)) {
      duplicates += 1;
      continue;
    }
    seen.add(host);
    domains.push(host);
  }
  return { domains, rejected, duplicates };
}
