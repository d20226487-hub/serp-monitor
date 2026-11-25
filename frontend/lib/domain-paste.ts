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
// "www." dropped from the stored domain. Subdomains are KEPT: kz.example.com
// and example.com are different targets and position tracking has to tell
// them apart. A "www." the user writes is noted and used for ONE thing: asking
// the AMP rotator, which matches site names exactly.

/** Anything that cannot appear inside a host. Tabs and newlines are the
 *  spreadsheet cases; commas and semicolons the copied-from-an-email ones. */
const SEPARATORS = /[\s,;|]+/;

/** Labels joined by dots. Deliberately permissive about the TLD — new gTLDs
 *  keep appearing, and rejecting an unknown one would drop exactly the doorway
 *  domains this tool exists to watch. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** The host part of a pasted token: lower case, no scheme, path, credentials,
 *  port or surrounding dots. "www." is still on it. */
function hostOf(raw: string): string {
  let s = (raw || "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!s) return "";
  // A URL, or a host with a path glued on: keep what comes before the slash.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split("/")[0];
  // Credentials and port are not part of the identity we compare on.
  s = s.split("@").pop() ?? s;
  s = s.split(":")[0];
  return s.replace(/^\.+|\.+$/g, "");
}

/** One pasted token as a bare host, or null when it is not one. */
export function normalizeDomain(raw: string): string | null {
  let s = hostOf(raw);
  if (s.startsWith("www.")) s = s.slice(4).replace(/^\.+/, "");
  // A trailing dot is a legal FQDN; an internal empty label is not.
  return HOST.test(s) ? s : null;
}

export type DomainParse = {
  /** The hosts to save, in the order pasted, first occurrence winning: bare,
   *  or with "www." where it was written that way. The server stores every
   *  domain bare and notes the "www." ones — that spelling is used ONLY to
   *  ask the AMP rotator, which matches site names exactly. Written both
   *  ways, the www spelling wins, as it does on the server. */
  domains: string[];
  /** Tokens that are not hosts. Reported rather than dropped in silence. */
  rejected: string[];
  /** Repeats collapsed — the same host under two spellings counts here. */
  duplicates: number;
};

export function parseDomains(text: string): DomainParse {
  // Bare host → its index in `domains`: repeats are found on the bare host,
  // so www.site.com and site.com are one domain.
  const at = new Map<string, number>();
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
    const www = hostOf(token).startsWith("www.");
    const i = at.get(host);
    if (i !== undefined) {
      duplicates += 1;
      if (www) domains[i] = `www.${host}`;
      continue;
    }
    at.set(host, domains.length);
    domains.push(www ? `www.${host}` : host);
  }
  return { domains, rejected, duplicates };
}

/** A saved project's domains as the form shows them: with "www." where the
 *  user wrote it, so reopening and saving keeps it. */
export function domainsAsWritten(domains: string[], wwwDomains: string[] | undefined): string[] {
  const www = new Set(wwwDomains ?? []);
  return domains.map(d => (www.has(d) ? `www.${d}` : d));
}
