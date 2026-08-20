"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Job, LocationRef, ProviderRates, SavedLocation } from "@/lib/api";
import { MultiCombobox, Option } from "./multi-combobox";
import { useT } from "@/lib/i18n";
import { formatUsd } from "@/lib/cost";

type Props = {
  initial?: Job;
  /** Called after a successful save (create or update). When provided, the
   * form delegates navigation/refresh to the parent — useful in inline-edit
   * mode where router.push to the same URL would not re-fetch. */
  onSaved?: (job: Job, opts: { ranAfter: boolean }) => void;
};

export function JobForm({ initial, onSaved }: Props) {
  const { t } = useT();
  const router = useRouter();

  const ENGINES: Option<string>[] = [
    { value: "google", label: t.jobForm.engineOptions.google },
    { value: "yandex", label: t.jobForm.engineOptions.yandex },
  ];
  const DEVICES: Option<string>[] = [
    { value: "desktop", label: t.jobForm.deviceOptions.desktop },
    { value: "mobile", label: t.jobForm.deviceOptions.mobile },
  ];
  const SCRAPE_FIELDS: Option<string>[] = [
    { value: "url", label: t.jobForm.scrapeFieldOptions.url },
    { value: "title", label: t.jobForm.scrapeFieldOptions.title },
    { value: "description", label: t.jobForm.scrapeFieldOptions.description },
  ];

  const [name, setName] = useState(initial?.name ?? "");
  const [keywordsText, setKeywordsText] = useState(
    initial?.keywords?.join("\n") ?? ""
  );
  const [engines, setEngines] = useState<string[]>(initial?.engines ?? ["google"]);
  const [devices, setDevices] = useState<string[]>(initial?.devices ?? ["desktop"]);
  const [locations, setLocations] = useState<LocationRef[]>(initial?.locations ?? []);
  const [languages, setLanguages] = useState<string[]>(initial?.languages ?? []);
  const [googleDomains, setGoogleDomains] = useState<string[]>(initial?.google_domains ?? []);
  const [scrapeFields, setScrapeFields] = useState<string[]>(
    initial?.scrape_fields ?? ["url", "title", "description"]
  );
  const [topN, setTopN] = useState<number>(initial?.top_n ?? 10);
  const [cron, setCron] = useState<string>(initial?.cron ?? "");
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(initial?.schedule_enabled ?? false);
  const [provider, setProvider] = useState<string>(initial?.provider ?? "serpapi");

  const [langOpts, setLangOpts] = useState<Option<string>[]>([]);
  const [gdOpts, setGdOpts] = useState<Option<string>[]>([]);
  const [estimate, setEstimate] = useState<{ total: number; breakdown: Record<string, number> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schedTz, setSchedTz] = useState<string>("UTC");
  // Used by the "Effective targeting" panel to look up yandex_lr / target_type
  // for locations the user has selected (LocationRef alone doesn't carry yandex_lr).
  const [savedByCanonical, setSavedByCanonical] = useState<Map<string, SavedLocation>>(new Map());
  // Per-provider $/search, used for the live cost estimate below the form.
  const [rates, setRates] = useState<ProviderRates | null>(null);

  useEffect(() => {
    api.listLanguages().then(rows =>
      setLangOpts(rows.map(r => ({ value: r.code, label: r.name, sub: r.code }))));
    api.listGoogleDomains().then(rows =>
      setGdOpts(rows.map(r => ({ value: r.domain, label: r.domain, sub: r.country }))));
    api.getSchedulerStatus().then(s => setSchedTz(s.timezone)).catch(() => {});
    api.getRates().then(setRates).catch(() => {});
    api.listSavedLocations().then(rows => {
      setSavedByCanonical(new Map(rows.map(r => [r.canonical_name, r])));
    }).catch(() => {});
  }, []);

  const keywords = useMemo(() =>
    keywordsText.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 100),
    [keywordsText]);

  // Local cost estimate (matches backend logic well enough for UI feedback)
  useEffect(() => {
    const kw = keywords.length;
    const eng = Math.max(engines.length, 1);
    const dev = Math.max(devices.length, 1);
    const loc = Math.max(locations.length, 1);
    const lang = Math.max(languages.length, 1);
    const gd = Math.max(googleDomains.length || 1, 1);

    const googleQ = engines.includes("google") ? kw * dev * loc * lang * gd : 0;
    const yandexQ = engines.includes("yandex") ? kw * dev * loc * lang : 0;
    const total = googleQ + yandexQ;
    setEstimate({ total, breakdown: { google: googleQ, yandex: yandexQ } });
    void eng;
  }, [keywords, engines, devices, locations, languages, googleDomains]);

  const buildPayload = (): Partial<Job> => ({
    name: name.trim(),
    keywords,
    engines,
    devices,
    locations,
    languages,
    google_domains: googleDomains,
    scrape_fields: scrapeFields,
    top_n: topN,
    cron: cron.trim() || null,
    schedule_enabled: !!cron.trim() && scheduleEnabled,
    provider,
  });

  async function save(runAfter = false) {
    setSaving(true); setError(null);
    try {
      const payload = buildPayload();
      if (!payload.name) throw new Error("Name is required");
      if (!keywords.length) throw new Error("At least 1 keyword is required");
      if (!engines.length) throw new Error("Pick at least one engine");
      if (!devices.length) throw new Error("Pick at least one device");
      const job = initial
        ? await api.updateJob(initial.id, payload)
        : await api.createJob(payload);
      if (runAfter) await api.runJob(job.id);
      if (onSaved) {
        // Parent is responsible for navigation/refresh (inline-edit case).
        onSaved(job, { ranAfter: runAfter });
      } else {
        router.push(`/jobs/${job.id}`);
        router.refresh();
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">{t.jobForm.name}</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t.jobForm.namePlaceholder}
          className="w-full px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 dark:border-neutral-700"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          {t.jobForm.keywords} <span className="text-neutral-500 text-xs">{t.jobForm.keywordsHint}</span>
        </label>
        <textarea
          value={keywordsText}
          onChange={e => setKeywordsText(e.target.value)}
          rows={8}
          placeholder={t.jobForm.keywordsPlaceholder}
          className="w-full px-3 py-2 rounded-md border font-mono text-sm bg-white dark:bg-neutral-900 dark:border-neutral-700"
        />
        <div className="text-xs text-neutral-500">{t.jobForm.keywordsCount(keywords.length)}</div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">{t.jobForm.provider}</label>
        <select
          value={provider}
          onChange={e => setProvider(e.target.value)}
          className="w-full px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 dark:border-neutral-700"
        >
          <option value="serpapi">SerpAPI</option>
          <option value="brightdata">Bright Data</option>
          <option value="oxylabs">Oxylabs</option>
          <option value="dataforseo">DataForSEO</option>
        </select>
        <p className="text-xs text-neutral-500">
          {t.jobForm.providerHelpPrefix}
          <a href="/settings" className="underline">{t.jobForm.providerHelpLink}</a>
          {t.jobForm.providerHelpSuffix}
        </p>
        {/* DataForSEO has no Yandex endpoint at all — warn at build time rather
            than letting the run fail per-variant with a ProviderConfigError. */}
        {provider === "dataforseo" && engines.includes("yandex") && (
          <div className="text-xs text-amber-700 dark:text-amber-300 border-l-4 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded">
            {t.jobForm.dataforseoNoYandex}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <MultiCombobox
          label={t.jobForm.engines}
          options={ENGINES}
          selected={engines}
          onChange={setEngines}
          placeholder={t.jobForm.enginesPlaceholder}
        />
        <MultiCombobox
          label={t.jobForm.devices}
          options={DEVICES}
          selected={devices}
          onChange={setDevices}
          placeholder={t.jobForm.devicesPlaceholder}
        />
      </div>

      <MultiCombobox<LocationRef>
        label={t.jobForm.locations}
        placeholder={t.jobForm.locationsPlaceholder}
        selected={locations}
        onChange={setLocations}
        fetchOptions={async (q) => {
          // Saved locations first (always shown, with a marker), then live SerpAPI
          // results below. Manage saved entries on the Settings page.
          const [saved, live] = await Promise.all([
            api.listSavedLocations(q || undefined).catch(() => []),
            q.trim().length >= 2
              ? api.searchLocations(q).catch(() => [])
              : Promise.resolve([]),
          ]);
          const seen = new Set(saved.map(s => s.canonical_name));
          const savedOpts = saved.map(s => ({
            value: {
              canonical_name: s.canonical_name,
              country_code: s.country_code ?? null,
              name: s.name ?? null,
              target_type: s.target_type ?? null,
            } as LocationRef,
            label: `★ ${s.canonical_name}`,
            sub: [s.target_type, s.country_code?.toUpperCase()].filter(Boolean).join(" · "),
          }));
          const liveOpts = live
            .filter(r => !seen.has(r.canonical_name))
            .map(r => ({
              value: r,
              label: r.canonical_name,
              sub: [r.target_type, r.country_code?.toUpperCase()].filter(Boolean).join(" · "),
            }));
          return [...savedOpts, ...liveOpts];
        }}
        renderChip={(v) => v.canonical_name}
        isEqual={(a, b) => a.canonical_name === b.canonical_name}
      />

      <EffectiveTargetingPanel
        provider={provider}
        engines={engines}
        locations={locations}
        savedByCanonical={savedByCanonical}
      />

      <div className="grid sm:grid-cols-2 gap-4">
        <MultiCombobox
          label={t.jobForm.languages}
          options={langOpts}
          selected={languages}
          onChange={setLanguages}
          placeholder={t.jobForm.languagesPlaceholder}
        />
        <MultiCombobox
          label={t.jobForm.googleDomains}
          options={gdOpts}
          selected={googleDomains}
          onChange={setGoogleDomains}
          placeholder={t.jobForm.googleDomainsPlaceholder}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <MultiCombobox
          label={t.jobForm.fieldsToScrape}
          options={SCRAPE_FIELDS}
          selected={scrapeFields}
          onChange={setScrapeFields}
        />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t.jobForm.topN}</label>
          <input
            type="number" min={1} max={100}
            value={topN}
            onChange={e => setTopN(Number(e.target.value) || 10)}
            className="w-full px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 dark:border-neutral-700"
          />
        </div>
      </div>

      <div className="border rounded-md p-4 dark:border-neutral-700 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">{t.jobForm.schedule}</div>
            <div className="text-xs text-neutral-500">
              {t.jobForm.cronHelpPrefix(schedTz)}
              {schedTz === "UTC" && t.jobForm.cronEditHint}
            </div>
          </div>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={e => setScheduleEnabled(e.target.checked)}
            />
            {t.jobForm.enabled}
          </label>
        </div>
        <input
          value={cron}
          onChange={e => setCron(e.target.value)}
          placeholder={t.jobForm.cronPlaceholder}
          className="w-full px-3 py-2 rounded-md border font-mono text-sm bg-white dark:bg-neutral-900 dark:border-neutral-700"
        />
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            [t.jobForm.cronPresets.hourly, "0 * * * *"],
            [t.jobForm.cronPresets.every6h, "0 */6 * * *"],
            [t.jobForm.cronPresets.daily06, "0 6 * * *"],
            [t.jobForm.cronPresets.daily09And21, "0 9,21 * * *"],
            [t.jobForm.cronPresets.weekdays08, "0 8 * * 1-5"],
          ].map(([label, expr]) => (
            <button
              key={expr} type="button"
              className="px-2 py-1 rounded border dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => setCron(expr)}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="border rounded-md p-4 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium mb-1">{t.jobForm.estimateTitle}</div>
            <div className="text-2xl font-semibold">{estimate?.total ?? 0}</div>
            <div className="text-xs text-neutral-500 mt-1">
              {t.jobForm.estimateBreakdown(estimate?.breakdown.google ?? 0, estimate?.breakdown.yandex ?? 0)}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium mb-1">{t.jobForm.estimateCostTitle}</div>
            <div className="text-2xl font-semibold">
              {formatUsd((estimate?.total ?? 0) * (rates?.rates[provider] ?? 0))}
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              {t.jobForm.estimateRate(formatUsd(rates?.rates[provider] ?? 0))}
              {" · "}
              <a href="/settings" className="underline">{t.jobForm.estimateEditRate}</a>
            </div>
          </div>
        </div>
        <div className="text-xs text-neutral-500 mt-3">
          {t.jobForm.estimateApprox}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          disabled={saving}
          onClick={() => save(false)}
          className="px-4 py-2 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 disabled:opacity-50"
        >
          {initial ? t.jobForm.saveChanges : t.jobForm.saveCreate}
        </button>
        <button
          disabled={saving}
          onClick={() => save(true)}
          className="px-4 py-2 rounded-md border dark:border-neutral-700 disabled:opacity-50"
        >
          {initial ? t.jobForm.saveAndRunUpdate : t.jobForm.saveAndRunCreate}
        </button>
      </div>
    </div>
  );
}


/* ---------------- Effective targeting panel ---------------- */
/* Tells the user, per selected location × engine, exactly what each provider
   will use to target geography. Greys out fields the provider doesn't honor
   so it's obvious when you'll get country-level instead of city-level. */

type Granularity = "city" | "country" | "none";

type GeoOutcome = {
  granularity: Granularity;
  via: string;            // human-readable: "uule", "location=", "lr=", "geo_location=", …
  detail?: string;        // value preview, e.g. "uule=...QWxtY..."
};

function googleOutcome(provider: string, loc: LocationRef, _saved?: SavedLocation): GeoOutcome {
  const cn = loc.canonical_name;
  const cc = loc.country_code?.toUpperCase();
  if (provider === "serpapi" && cn) {
    return { granularity: "city", via: "location=", detail: cn };
  }
  if (provider === "brightdata" && cn) {
    return { granularity: "city", via: "uule=", detail: `gl=${cc ?? "—"} + uule(${cn})` };
  }
  if (provider === "oxylabs" && cn) {
    return { granularity: "city", via: "geo_location=", detail: `${cn} (best-effort match)` };
  }
  if (provider === "dataforseo" && cn) {
    // DataForSEO's location_name uses the same Google Ads canonical format as
    // SerpAPI, so our saved canonical_name passes straight through.
    return { granularity: "city", via: "location_name=", detail: cn };
  }
  if (cc) return { granularity: "country", via: "gl=", detail: cc };
  return { granularity: "none", via: "—" };
}

function yandexOutcome(provider: string, loc: LocationRef, saved?: SavedLocation): GeoOutcome {
  // DataForSEO has no Yandex endpoint — nothing gets sent at all.
  if (provider === "dataforseo") {
    return { granularity: "none", via: "unsupported" };
  }
  const lr = saved?.yandex_lr;
  const cc = loc.country_code?.toUpperCase();
  if (lr != null) {
    return { granularity: "city", via: "lr=", detail: `lr=${lr}` };
  }
  if (cc) return { granularity: "country", via: "yandex_domain", detail: `→ yandex.${cc.toLowerCase()}` };
  return { granularity: "none", via: "—" };
}

function GranBadge({ g }: { g: Granularity }) {
  const { t } = useT();
  const cls =
    g === "city" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
    : g === "country" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
  const label =
    g === "city" ? t.jobForm.targeting.gran.city
    : g === "country" ? t.jobForm.targeting.gran.country
    : t.jobForm.targeting.gran.none;
  return (
    <span className={`inline-block text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  );
}

function EngineRow({
  engine, outcome,
}: { engine: "google" | "yandex"; outcome: GeoOutcome }) {
  const { t } = useT();
  const name = engine === "google" ? t.jobForm.targeting.engineGoogle : t.jobForm.targeting.engineYandex;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-neutral-500">{name}</span>
      <GranBadge g={outcome.granularity} />
      <span className="text-neutral-600 dark:text-neutral-400 font-mono truncate">
        {outcome.via}{outcome.detail ? `  ${outcome.detail}` : ""}
      </span>
    </div>
  );
}

function EffectiveTargetingPanel({
  provider, engines, locations, savedByCanonical,
}: {
  provider: string;
  engines: string[];
  locations: LocationRef[];
  savedByCanonical: Map<string, SavedLocation>;
}) {
  const { t } = useT();
  if (locations.length === 0) {
    return (
      <div className="text-xs text-neutral-500 italic">
        {t.jobForm.targeting.noLocations}
      </div>
    );
  }
  const showGoogle = engines.includes("google");
  const showYandex = engines.includes("yandex");

  return (
    <div className="border rounded-md p-3 dark:border-neutral-700 space-y-2">
      <div className="text-xs uppercase tracking-wide font-semibold text-neutral-500">
        {t.jobForm.targeting.header(provider)}
      </div>
      <div className="space-y-2">
        {locations.map(loc => {
          const saved = savedByCanonical.get(loc.canonical_name);
          return (
            <div key={loc.canonical_name} className="border-t pt-2 first:border-t-0 first:pt-0 dark:border-neutral-800">
              <div className="text-sm font-medium break-all">{loc.canonical_name}</div>
              <div className="space-y-1 mt-1">
                {showGoogle && <EngineRow engine="google" outcome={googleOutcome(provider, loc, saved)} />}
                {showYandex && <EngineRow engine="yandex" outcome={yandexOutcome(provider, loc, saved)} />}
                {!showGoogle && !showYandex && (
                  <div className="text-xs text-neutral-500 italic">{t.jobForm.targeting.noEngines}</div>
                )}
              </div>
              {/* Skip the lr hint for DataForSEO — Yandex won't run there at
                  all, so telling the user to add a region ID would mislead. */}
              {showYandex && provider !== "dataforseo" && !saved?.yandex_lr && (
                <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                  {t.jobForm.targeting.noLrWarning}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
