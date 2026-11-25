import { describe, expect, it } from "vitest";
import { domainsAsWritten, normalizeDomain, parseDomains } from "@/lib/domain-paste";

describe("normalizeDomain", () => {
  it("strips everything that is not the host", () => {
    for (const raw of [
      "https://example.com/path?q=1",
      "http://www.example.com",
      "WWW.Example.COM",
      "example.com:8443",
      "  example.com/  ",
      "user:pw@example.com",
    ]) {
      expect(normalizeDomain(raw)).toBe("example.com");
    }
  });

  it("keeps subdomains", () => {
    // kz.example.com and example.com are different targets — a doorway on a
    // subdomain is exactly what this tool watches for.
    expect(normalizeDomain("https://kz.example.com/")).toBe("kz.example.com");
    expect(normalizeDomain("m.parimatch.kz")).toBe("m.parimatch.kz");
  });

  it("accepts unknown TLDs", () => {
    // New gTLDs keep appearing, and rejecting one would drop the doorway
    // domains that matter most here.
    expect(normalizeDomain("boostwin.lol")).toBe("boostwin.lol");
    expect(normalizeDomain("some-thing.xn--p1ai")).toBe("some-thing.xn--p1ai");
  });

  it("rejects what is not a host", () => {
    for (const raw of ["", "   ", "not a domain", "localhost", "example", "..", "-.com"]) {
      expect(normalizeDomain(raw)).toBeNull();
    }
  });
});

describe("parseDomains", () => {
  it("accepts any separator one paste might use", () => {
    const { domains, rejected } = parseDomains("a.com\nb.com, c.com;d.com\te.com|f.com");
    expect(domains).toEqual(["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"]);
    expect(rejected).toEqual([]);
  });

  it("keeps pasted order and counts repeats", () => {
    // A list someone arranged by importance comes back arranged the same way;
    // the duplicate here is the same host under two spellings.
    // Written both ways, the www spelling wins (the AMP rotator is asked about
    // it that way) — but the domain keeps the place it was first pasted at.
    const { domains, duplicates } = parseDomains("zeta.com\nalpha.com\nhttps://www.ZETA.com/x");
    expect(domains).toEqual(["www.zeta.com", "alpha.com"]);
    expect(duplicates).toBe(1);
  });

  it("keeps a www. the user wrote and trims everything else", () => {
    // The rotator matches site names exactly: a site held there as
    // www.domain.com answers nothing for domain.com.
    const { domains } = parseDomains(
      "WWW.Site-One.example\nhttps://www.site-two.example:443/promo?x=1\nsite-three.example",
    );
    expect(domains).toEqual(["www.site-one.example", "www.site-two.example", "site-three.example"]);
    // The stored domain itself is still bare.
    expect(normalizeDomain("WWW.Site-One.example")).toBe("site-one.example");
  });

  it("reopens a saved project with its www. spellings back on", () => {
    expect(domainsAsWritten(["a.example", "b.example"], ["b.example"]))
      .toEqual(["a.example", "www.b.example"]);
    expect(domainsAsWritten(["a.example"], undefined)).toEqual(["a.example"]);
  });

  it("reports rejects rather than dropping them silently", () => {
    // Forty pasted domains where three vanished is the mistake worth catching
    // while the textarea is still open.
    const { domains, rejected } = parseDomains("good.com\nnonsense\nalso-good.net");
    expect(domains).toEqual(["good.com", "also-good.net"]);
    expect(rejected).toEqual(["nonsense"]);
  });

  it("handles an empty paste", () => {
    expect(parseDomains("")).toEqual({ domains: [], rejected: [], duplicates: 0 });
    expect(parseDomains("  \n \n ").domains).toEqual([]);
  });
});
