// Reconstruct the user-facing browser URL for each scraped variant so the
// user can click through and visually verify Google/Yandex SERPs against
// what we extracted. These URLs deliberately omit provider-specific noise
// (brd_json, parse, source, …) — just the params Yandex/Google themselves
// honor in the address bar.
//
// Keyword and language live on each Result row; yandex_lr lives on the
// SavedLocation matching the canonical_name (passed in via lrLookup).

import { googleUule } from "./uule";

/** Everything that identifies a SERP — the tuple that decides which results
 *  page an engine returns. A keyword is asked OF one of these, so it is not
 *  part of the identity and lives on VariantUrlInput instead. */
export type VariantDescriptor = {
  engine: string;             // "google" | "yandex"
  device: string;             // "desktop" | "mobile"
  country_code: string | null;
  language: string | null;
  location: string | null;    // canonical_name (e.g. "Almaty,Almaty Province,Kazakhstan")
  google_domain: string | null;
  yandex_lr: number | null;
};

export type VariantUrlInput = VariantDescriptor & { keyword: string };

const GOOGLE_BY_COUNTRY: Record<string, string> = {
  kz: "google.kz", ru: "google.ru", ua: "google.com.ua", by: "google.by",
  uz: "google.co.uz", kg: "google.kg", tj: "google.com.tj", tm: "google.com.tm",
  tr: "google.com.tr", az: "google.az", am: "google.am", ge: "google.ge",
  us: "google.com", gb: "google.co.uk", de: "google.de", fr: "google.fr",
  es: "google.es", it: "google.it", nl: "google.nl", pl: "google.pl",
  br: "google.com.br", ca: "google.ca", au: "google.com.au", in: "google.co.in",
  jp: "google.co.jp", kr: "google.co.kr", sg: "google.com.sg", mx: "google.com.mx",
  ar: "google.com.ar", ae: "google.ae", sa: "google.com.sa",
};

const YANDEX_BY_COUNTRY: Record<string, string> = {
  ru: "yandex.ru", by: "yandex.by", kz: "yandex.kz", uz: "yandex.uz",
  tr: "yandex.com.tr",
};

function buildGoogleBrowserUrl(v: VariantUrlInput): string {
  const cc = v.country_code?.toLowerCase() ?? null;
  const domain = v.google_domain || (cc && GOOGLE_BY_COUNTRY[cc]) || "google.com";
  const params = new URLSearchParams();
  params.set("q", v.keyword);
  if (cc) params.set("gl", cc);
  if (v.language) params.set("hl", v.language);
  const uule = googleUule(v.location);
  if (uule) params.set("uule", uule);
  return `https://www.${domain}/search?${params.toString()}`;
}

function buildYandexBrowserUrl(v: VariantUrlInput): string {
  const cc = v.country_code?.toLowerCase() ?? null;
  const domain = (cc && YANDEX_BY_COUNTRY[cc]) || "yandex.com";
  const params = new URLSearchParams();
  params.set("text", v.keyword);
  if (v.yandex_lr != null) params.set("lr", String(v.yandex_lr));
  if (v.language) params.set("lang", v.language);
  return `https://${domain}/search/?${params.toString()}`;
}

export function buildBrowserUrl(v: VariantUrlInput): string {
  return v.engine === "yandex" ? buildYandexBrowserUrl(v) : buildGoogleBrowserUrl(v);
}

export type VariantLabelStrings = {
  google: string;
  yandex: string;
  desktop: string;
  mobile: string;
  country: string;
  noGeo: string;
};

/**
 * Human-readable label for a variant. Goes next to each URL so the user can
 * tell at a glance which combination it represents. Caller supplies localized
 * strings for engine/device/geo terms; raw provider tokens (`lr=`, `uule`,
 * country codes) stay untranslated since they're protocol-level identifiers.
 */
export function variantLabel(v: VariantDescriptor, s: VariantLabelStrings): string {
  const engine = v.engine === "yandex" ? s.yandex : s.google;
  const device = v.device === "mobile" ? s.mobile : s.desktop;

  // Geographic precision marker
  let geo: string;
  if (v.location) {
    const shortLoc = v.location.split(",")[0];
    let prec: string;
    if (v.engine === "yandex") {
      prec = v.yandex_lr != null ? `lr=${v.yandex_lr}` : s.country;
    } else {
      prec = "uule";
    }
    geo = `${shortLoc} (${prec})`;
  } else if (v.country_code) {
    geo = `${v.country_code.toUpperCase()} (${s.country})`;
  } else {
    geo = s.noGeo;
  }

  const parts = [engine, device, geo];
  if (v.language) parts.push(v.language);
  return parts.join(" · ");
}
