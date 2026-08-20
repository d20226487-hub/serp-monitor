"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";

export type Lang = "en" | "ru";

const STORAGE_KEY = "lang";

// Russian three-form plural selector (one / few / many).
function pluralRu(n: number, [one, few, many]: [string, string, string]): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const messagesEn = {
  appName: "SERP Monitor",
  langName: { en: "EN", ru: "RU" },
  langSwitchTitle: "Language",
  themeSwitchToLight: "Switch to light mode",
  themeSwitchToDark: "Switch to dark mode",
  common: {
    loading: "Loading…",
    cancel: "Cancel",
    save: "Save",
    saved: "Saved.",
    cleared: "Cleared.",
    test: "Test",
    clear: "Clear",
    edit: "Edit",
    open: "Open",
    rename: "Rename",
    delete: "Delete",
    add: "Add",
    import: "Import",
    copy: "Copy",
    copyAll: "Copy all",
    download: "Download",
    filter: "Filter…",
    yourTime: "your time",
  },
  nav: {
    jobs: "Jobs",
    newJob: "New job",
    settings: "Settings",
    docs: "Документация",
  },
  home: {
    title: "Jobs",
    newJob: "+ New job",
    empty: "No jobs yet. Create your first one.",
    run: "Run",
    renamePrompt: "New name?",
    deleteConfirm: (name: string) => `Delete "${name}" and all its runs?`,
    kwCount: (n: number) => `${n} kw`,
    locCount: (n: number) => `${n} location(s)`,
    langCount: (n: number) => `${n} lang(s)`,
  },
  jobs: {
    newTitle: "New job",
    editPrefix: (name: string) => `Edit: ${name}`,
    runNow: "Run now",
    fields: {
      provider: "Provider",
      keywords: "Keywords",
      engines: "Engines",
      devices: "Devices",
      languages: "Languages",
      locations: "Locations",
      googleDomains: "Google domains",
      topN: "Top N",
      schedule: "Schedule",
    },
    keywordsCount: (n: number) => `${n} keyword(s)`,
    autoFallback: "auto",
    runs: "Runs",
    noRuns: "No runs yet.",
    totalCost: (total: string, n: number) =>
      `${total} total across ${n} run${n === 1 ? "" : "s"}`,
    runEntry: {
      runLabel: (id: number) => `Run #${id}`,
      progress: (done: number, total: number) => `${done}/${total} done`,
      failed: (n: number) => `${n} failed`,
    },
    schedule: {
      enabled: "enabled",
      disabled: "disabled",
      cronInTz: (tz: string) => <>cron is in <strong>{tz}</strong></>,
      notRegistered: "⚠ not registered with scheduler — try toggling and saving again",
      nextRun: (when: string) => <>Next run: <strong>{when}</strong> (your time)</>,
    },
    statusBadge: {
      pending: "pending",
      running: "running",
      done: "done",
      failed: "failed",
      canceled: "canceled",
    },
  },
  jobForm: {
    name: "Name",
    namePlaceholder: "e.g. Brand monitoring — KZ/RU",
    keywords: "Keywords",
    keywordsHint: "(one per line, max 100)",
    keywordsPlaceholder: "acme login\nacme review\nacme скачать",
    keywordsCount: (n: number) => `${n} keyword(s)`,
    provider: "Provider",
    providerHelpPrefix: "Configure provider credentials in ",
    providerHelpLink: "Settings",
    providerHelpSuffix:
      " first. Each provider differs slightly: SerpAPI and DataForSEO accept canonical_name locations; Bright Data & Oxylabs only honor country / yandex_lr.",
    dataforseoNoYandex:
      "⚠ DataForSEO has no Yandex endpoint — their SERP API covers Google, Bing, Yahoo, Baidu, Naver and Seznam only. Yandex searches in this job will fail. Use SerpAPI, Bright Data or Oxylabs for Yandex, or remove Yandex from Engines and keep DataForSEO for Google.",
    engines: "Engines",
    enginesPlaceholder: "Pick engines…",
    devices: "Devices",
    devicesPlaceholder: "Pick devices…",
    locations: "Locations (countries / regions / cities)",
    locationsPlaceholder: "Pick from saved or search SerpAPI…",
    languages: "Languages",
    languagesPlaceholder: "Pick languages…",
    googleDomains: "Google domains (optional)",
    googleDomainsPlaceholder: "Defaults from country if empty",
    fieldsToScrape: "Fields to scrape",
    topN: "Top N positions",
    schedule: "Schedule",
    cronHelpPrefix: (tz: string) => (
      <>
        Cron expression in <strong>{tz}</strong>. E.g. <code>0 */6 * * *</code> = every 6 hours.
      </>
    ),
    cronEditHint: (
      <>
        {" "}Edit <code>scheduler.py</code> &amp; restart api to change.
      </>
    ),
    enabled: "Enabled",
    cronPlaceholder: "0 */6 * * *",
    cronPresets: {
      hourly: "Hourly",
      every6h: "Every 6h",
      daily06: "Daily 06:00",
      daily09And21: "Daily 09:00 + 21:00",
      weekdays08: "Weekdays 08:00",
    },
    estimateTitle: "Estimated calls per run",
    estimateBreakdown: (g: number, y: number) => `Google: ${g} · Yandex: ${y}`,
    estimateApprox: "(Approximate — backend dedupes identical variants.)",
    estimateCostTitle: "Estimated cost per run",
    estimateRate: (rate: string) => `at ${rate}/search`,
    estimateEditRate: "edit rate",
    saveCreate: "Create job",
    saveChanges: "Save changes",
    saveAndRunCreate: "Create & run now",
    saveAndRunUpdate: "Save & run now",
    engineOptions: { google: "Google", yandex: "Yandex" },
    deviceOptions: { desktop: "Desktop", mobile: "Mobile" },
    scrapeFieldOptions: {
      url: "URL",
      title: "Title",
      description: "Meta description",
    },
    targeting: {
      noLocations:
        "No locations chosen — queries will run with no geo targeting (or country-default if a Google domain is set).",
      header: (provider: string) => (
        <>
          Effective targeting · provider:{" "}
          <span className="text-neutral-800 dark:text-neutral-200">{provider}</span>
        </>
      ),
      noEngines: "No engines selected.",
      noLrWarning: (
        <>
          ⚠ No <code>yandex_lr</code> saved for this location — Yandex falls back
          to country domain only. Add a Yandex region ID in Settings → this location.
        </>
      ),
      gran: { city: "city", country: "country", none: "no geo" },
      engineGoogle: "Google",
      engineYandex: "Yandex",
    },
  },
  run: {
    title: (id: number) => `Run #${id}`,
    headerStats: (done: number, total: number) =>
      `${done}/${total} queries`,
    failed: (n: number) => `${n} failed`,
    exportTop: "Export top",
    downloadCsv: "Download CSV",
    filterPlaceholder: "Filter by keyword…",
    verify: {
      title: "Verify scraped queries",
      summary: (n: number) =>
        `(${n} unique request${n === 1 ? "" : "s"} — click any URL to see exactly what Google / Yandex would show)`,
      footer: (
        <>
          These are the human-readable URLs the search engines themselves accept —
          provider-specific params (<code>brd_json</code>, <code>parse</code>,{" "}
          <code>source</code>, etc.) are stripped so what you see in the browser is
          what we asked Google/Yandex for.{" "}
          <strong>Mobile variants</strong> look identical to desktop in the URL for
          both engines — mobile SERPs are User-Agent driven. Use Chrome dev-tools
          (Ctrl+Shift+M) to switch User-Agent if you need to verify a mobile scrape
          against the live SERP.
        </>
      ),
    },
    groupCount: (results: number, variants: number) =>
      `${results} result(s) · ${variants} variant(s)`,
    streaming: "Results are streaming in…",
    noResults: "No results.",
    overview: {
      title: "Overview",
      hint: "Domain & URL distribution across all searches in this run.",
      engineGoogle: "Google",
      engineYandex: "Yandex",
      engineSummary: (n: number) => `${n} result row(s)`,
      domainsTitle: "Domains",
      urlsTitle: "URLs",
      colDomain: "Domain",
      colUrl: "URL",
      colCount: "Count",
      colAvgPos: "Avg. pos.",
      noneForEngine: "No rows for this engine.",
      fullBreakdown: "Full breakdown →",
    },
  },
  overviewPage: {
    title: (id: number) => `Overview — Run #${id}`,
    back: "← Back to run",
    groupBy: "Group by",
    dimEngine: "Engine",
    dimGeo: "GEO",
    dimLanguage: "Language",
    dimDevice: "Device",
    combinations: (n: number) => `${n} combination(s)`,
    allResults: "All results",
    rowsInGroup: (n: number) => `${n} row(s)`,
    empty: "No results in this run yet.",
  },
  variantLabel: {
    google: "Google",
    yandex: "Yandex",
    desktop: "Desktop",
    mobile: "Mobile",
    country: "country",
    noGeo: "no geo",
  },
  settings: {
    title: "Settings",
    intro: "Configure provider credentials and curate your saved locations.",
    addLocation: {
      title: "Add a location",
      help: (
        <>
          <code>canonical_name</code> uses SerpAPI&rsquo;s comma-separated format.{" "}
          <code>yandex_lr</code> is Yandex&rsquo;s numeric region ID — required for
          city-level Yandex targeting (e.g. Moscow=213, Almaty=162, Tashkent=11353).
        </>
      ),
      phCanonical: "canonical_name",
      phName: "display name",
      phCc: "cc (kz, uz…)",
      phType: "type…",
      phYandexLr: "yandex_lr",
      typeOptions: {
        Country: "Country",
        Region: "Region",
        City: "City",
        Other: "Other",
      },
    },
    bulk: {
      title: "Bulk import",
      help: (
        <>
          One per line. Tab- or pipe-separated columns:
          <code> canonical_name | name | country_code | target_type | yandex_lr</code>.
          Only the first column is required. Duplicates skipped silently.
        </>
      ),
      result: (added: number, skipped: number) =>
        `Added ${added}, skipped ${skipped} (duplicates)`,
    },
    list: {
      heading: (n: number) => `Saved locations (${n})`,
      perProviderHelp: (
        <>
          What gets sent per provider, derived from each row:{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            SerpAPI
          </span>{" "}
          uses <code>location=canonical_name</code> &amp; <code>gl=CC</code>.{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Bright Data Google
          </span>{" "}
          uses <code>gl=CC</code> &amp; the computed <code>uule=</code> below.{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Oxylabs Google
          </span>{" "}
          uses <code>geo_location=canonical_name</code> (best-effort match
          against Oxylabs&rsquo; own DB; falls back to country if the city
          isn&rsquo;t recognized).{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Yandex
          </span>{" "}
          (any provider) uses <code>lr=yandex_lr</code>.
        </>
      ),
      cols: {
        canonical: "canonical_name",
        name: "Name",
        cc: "CC",
        type: "Type",
        yandexLr: "yandex_lr",
        uule: "uule (Bright Data Google)",
      },
      empty: "No locations match.",
      deleteConfirm: "Delete this location?",
      copyUuleTitle: "Copy full UULE",
    },
    rates: {
      title: "Cost rates",
      help:
        "What you pay per search, per provider. Used for the cost estimate on the job form and for run costs where the provider doesn't report a real figure. Rates depend on your plan — set your actual ones here.",
      usingDefault: "using default",
      defaultIs: (v: string) => `default: $${v}`,
      footnote:
        "DataForSEO reports its real cost per request, so its runs record actual spend and ignore this rate. SerpAPI, Bright Data and Oxylabs don't return a price, so their runs are estimated from the rate above. Clear a field to restore its default.",
    },
    providers: {
      title: "Providers",
      configured: "configured",
      partial: "partial",
      notSet: "not set",
      savedSecret: (last4: string, length: number) => (
        <>
          Saved: <code>••••{last4}</code> ({length} chars)
        </>
      ),
      savedPlain: (value: string) => (
        <>
          Saved: <code>{value}</code>
        </>
      ),
      savedNoDetail: "Saved.",
      worksOk: (provider: string) => `✓ ${provider} works.`,
      plan: (plan: string) => (
        <>
          {" "}Plan: <strong>{plan}</strong>.
        </>
      ),
      searchesLeft: (n: number) => (
        <>
          {" "}Searches left: <strong>{n}</strong>.
        </>
      ),
      balance: (n: number) => (
        <>
          {" "}Balance: <strong>${n}</strong>.
        </>
      ),
      clearConfirm: (provider: string) =>
        `Clear all stored credentials for ${provider}?`,
      meta: {
        serpapi: {
          help: "Default provider. Get a key at serpapi.com/manage-api-key. The DB value overrides SERPAPI_KEY from .env.",
          api_key: { label: "API key", placeholder: "Paste SerpAPI key…" },
        },
        brightdata: {
          help:
            "Two zones recommended: `zone` set to Full JSON for Google, `zone_raw` set to Raw HTML for Yandex (Bright Data's Full-JSON parser doesn't cover Yandex on most plans, so we fetch the page and parse it ourselves). Leave `zone_raw` blank if you only need Google.",
          token: {
            label: "API token",
            placeholder: "Bearer token from Bright Data dashboard",
          },
          zone: {
            label: "Zone (Full JSON, for Google)",
            placeholder: "e.g. serp_api1",
          },
          zone_raw: {
            label: "Zone (Raw HTML, for Yandex) — optional",
            placeholder: "e.g. serp_raw",
          },
        },
        oxylabs: {
          help: "SERP Scraper API at realtime.oxylabs.io. Use the username and password from your Oxylabs SERP Scraper sub-account.",
          username: { label: "Username", placeholder: "Oxylabs SERP username" },
          password: { label: "Password", placeholder: "Oxylabs password" },
        },
        dataforseo: {
          help:
            "Google only — DataForSEO has no Yandex endpoint. Live mode (~$0.002 per search, results in a few seconds). Credentials come from app.dataforseo.com/api-access; the API password is auto-generated and is NOT your account password. Testing is free (checks your balance without spending credit).",
          login: { label: "Login (email)", placeholder: "you@example.com" },
          password: { label: "API password", placeholder: "Auto-generated API password" },
        },
      },
    },
  },
  combobox: {
    searching: "Searching…",
    noMatches: "No matches.",
  },
  cost: {
    estimated: "est.",
    actualHint: "Actual cost reported by the provider",
    estimateHint: "Estimated: queries × the rate configured in Settings",
  },
};

type Messages = typeof messagesEn;

const messagesRu: Messages = {
  appName: "SERP Monitor",
  langName: { en: "EN", ru: "RU" },
  langSwitchTitle: "Язык",
  themeSwitchToLight: "Переключить на светлую тему",
  themeSwitchToDark: "Переключить на тёмную тему",
  common: {
    loading: "Загрузка…",
    cancel: "Отмена",
    save: "Сохранить",
    saved: "Сохранено.",
    cleared: "Очищено.",
    test: "Проверить",
    clear: "Очистить",
    edit: "Изменить",
    open: "Открыть",
    rename: "Переименовать",
    delete: "Удалить",
    add: "Добавить",
    import: "Импортировать",
    copy: "Скопировать",
    copyAll: "Скопировать всё",
    download: "Скачать",
    filter: "Фильтр…",
    yourTime: "ваше время",
  },
  nav: {
    jobs: "Задачи",
    newJob: "Новая задача",
    settings: "Настройки",
    docs: "Документация",
  },
  home: {
    title: "Задачи",
    newJob: "+ Новая задача",
    empty: "Задач пока нет. Создайте первую.",
    run: "Запустить",
    renamePrompt: "Новое название?",
    deleteConfirm: (name: string) =>
      `Удалить «${name}» и все её запуски?`,
    kwCount: (n: number) =>
      `${n} ${pluralRu(n, ["ключевое слово", "ключевых слова", "ключевых слов"])}`,
    locCount: (n: number) =>
      `${n} ${pluralRu(n, ["локация", "локации", "локаций"])}`,
    langCount: (n: number) =>
      `${n} ${pluralRu(n, ["язык", "языка", "языков"])}`,
  },
  jobs: {
    newTitle: "Новая задача",
    editPrefix: (name: string) => `Изменение: ${name}`,
    runNow: "Запустить сейчас",
    fields: {
      provider: "Провайдер",
      keywords: "Ключевые слова",
      engines: "Поисковики",
      devices: "Устройства",
      languages: "Языки",
      locations: "Геолокации",
      googleDomains: "Домены Google",
      topN: "Топ N",
      schedule: "Расписание",
    },
    keywordsCount: (n: number) =>
      `${n} ${pluralRu(n, ["ключевое слово", "ключевых слова", "ключевых слов"])}`,
    autoFallback: "авто",
    runs: "Запуски",
    noRuns: "Запусков пока нет.",
    totalCost: (total: string, n: number) =>
      `${total} всего за ${n} ${pluralRu(n, ["запуск", "запуска", "запусков"])}`,
    runEntry: {
      runLabel: (id: number) => `Запуск №${id}`,
      progress: (done: number, total: number) =>
        `${done}/${total} ${pluralRu(total, ["выполнен", "выполнено", "выполнено"])}`,
      failed: (n: number) =>
        `${n} ${pluralRu(n, ["ошибка", "ошибки", "ошибок"])}`,
    },
    schedule: {
      enabled: "включено",
      disabled: "выключено",
      cronInTz: (tz: string) => (
        <>
          часовой пояс cron — <strong>{tz}</strong>
        </>
      ),
      notRegistered:
        "⚠ не зарегистрировано в планировщике — попробуйте переключить и сохранить ещё раз",
      nextRun: (when: string) => (
        <>
          Следующий запуск: <strong>{when}</strong> (ваше время)
        </>
      ),
    },
    statusBadge: {
      pending: "ожидает",
      running: "выполняется",
      done: "завершено",
      failed: "ошибка",
      canceled: "отменено",
    },
  },
  jobForm: {
    name: "Название",
    namePlaceholder: "напр. Мониторинг бренда — KZ/RU",
    keywords: "Ключевые слова",
    keywordsHint: "(по одному на строку, не более 100)",
    keywordsPlaceholder: "acme вход\nacme отзывы\nacme скачать",
    keywordsCount: (n: number) =>
      `${n} ${pluralRu(n, ["ключевое слово", "ключевых слова", "ключевых слов"])}`,
    provider: "Провайдер",
    providerHelpPrefix: "Сначала укажите учётные данные провайдеров в разделе ",
    providerHelpLink: "Настройки",
    providerHelpSuffix:
      ". Провайдеры немного отличаются: SerpAPI и DataForSEO принимают локации в формате canonical_name; Bright Data и Oxylabs учитывают только страну / yandex_lr.",
    dataforseoNoYandex:
      "⚠ У DataForSEO нет эндпоинта для Яндекса — их SERP API поддерживает только Google, Bing, Yahoo, Baidu, Naver и Seznam. Запросы к Яндексу в этой задаче завершатся ошибкой. Используйте SerpAPI, Bright Data или Oxylabs для Яндекса, либо уберите Яндекс из поисковиков и оставьте DataForSEO для Google.",
    engines: "Поисковики",
    enginesPlaceholder: "Выберите поисковики…",
    devices: "Устройства",
    devicesPlaceholder: "Выберите устройства…",
    locations: "Геолокации (страны / регионы / города)",
    locationsPlaceholder: "Выберите из сохранённых или найдите через SerpAPI…",
    languages: "Языки",
    languagesPlaceholder: "Выберите языки…",
    googleDomains: "Домены Google (необязательно)",
    googleDomainsPlaceholder: "Если пусто — берётся из страны",
    fieldsToScrape: "Извлекаемые поля",
    topN: "Топ N позиций",
    schedule: "Расписание",
    cronHelpPrefix: (tz: string) => (
      <>
        Cron-выражение в часовом поясе <strong>{tz}</strong>. Напр.{" "}
        <code>0 */6 * * *</code> = каждые 6 часов.
      </>
    ),
    cronEditHint: (
      <>
        {" "}Чтобы изменить, отредактируйте <code>scheduler.py</code> и перезапустите api.
      </>
    ),
    enabled: "Включено",
    cronPlaceholder: "0 */6 * * *",
    cronPresets: {
      hourly: "Каждый час",
      every6h: "Каждые 6 ч",
      daily06: "Ежедневно 06:00",
      daily09And21: "Ежедневно 09:00 + 21:00",
      weekdays08: "Будни 08:00",
    },
    estimateTitle: "Расчётное число запросов за прогон",
    estimateBreakdown: (g: number, y: number) => `Google: ${g} · Yandex: ${y}`,
    estimateApprox:
      "(Приблизительно — бэкенд удаляет дубликаты вариантов.)",
    estimateCostTitle: "Расчётная стоимость прогона",
    estimateRate: (rate: string) => `по ${rate} за запрос`,
    estimateEditRate: "изменить ставку",
    saveCreate: "Создать задачу",
    saveChanges: "Сохранить изменения",
    saveAndRunCreate: "Создать и запустить",
    saveAndRunUpdate: "Сохранить и запустить",
    engineOptions: { google: "Google", yandex: "Yandex" },
    deviceOptions: { desktop: "Десктоп", mobile: "Мобильный" },
    scrapeFieldOptions: {
      url: "URL",
      title: "Заголовок",
      description: "Мета-описание",
    },
    targeting: {
      noLocations:
        "Локации не выбраны — запросы будут выполняться без гео-таргетинга (или со страной по умолчанию, если задан домен Google).",
      header: (provider: string) => (
        <>
          Фактический таргетинг · провайдер:{" "}
          <span className="text-neutral-800 dark:text-neutral-200">{provider}</span>
        </>
      ),
      noEngines: "Поисковики не выбраны.",
      noLrWarning: (
        <>
          ⚠ Для этой локации не задан <code>yandex_lr</code> — Яндекс будет
          использовать только домен страны. Добавьте ID региона Яндекса в
          разделе «Настройки» для этой локации.
        </>
      ),
      gran: { city: "город", country: "страна", none: "без гео" },
      engineGoogle: "Google",
      engineYandex: "Яндекс",
    },
  },
  run: {
    title: (id: number) => `Запуск №${id}`,
    headerStats: (done: number, total: number) =>
      `${done}/${total} ${pluralRu(total, ["запрос", "запроса", "запросов"])}`,
    failed: (n: number) =>
      `${n} ${pluralRu(n, ["ошибка", "ошибки", "ошибок"])}`,
    exportTop: "Экспортировать топ",
    downloadCsv: "Скачать CSV",
    filterPlaceholder: "Фильтр по ключевому слову…",
    verify: {
      title: "Проверить выполненные запросы",
      summary: (n: number) =>
        `(${n} ${pluralRu(n, ["уникальный запрос", "уникальных запроса", "уникальных запросов"])} — кликните по URL, чтобы увидеть, что показал бы Google / Яндекс)`,
      footer: (
        <>
          Это те же URL, которые принимают сами поисковые системы — параметры
          провайдера (<code>brd_json</code>, <code>parse</code>,{" "}
          <code>source</code> и т. п.) удалены, поэтому в браузере вы увидите
          ровно то, что мы запрашивали у Google/Яндекса.{" "}
          <strong>Мобильные варианты</strong> в URL выглядят так же, как
          десктопные, у обоих поисковиков — мобильная выдача определяется
          User-Agent. Используйте инструменты разработчика Chrome
          (Ctrl+Shift+M), чтобы переключить User-Agent для проверки мобильного
          скрапа на живой выдаче.
        </>
      ),
    },
    groupCount: (results: number, variants: number) =>
      `${results} ${pluralRu(results, ["результат", "результата", "результатов"])} · ${variants} ${pluralRu(variants, ["вариант", "варианта", "вариантов"])}`,
    streaming: "Результаты поступают…",
    noResults: "Результатов нет.",
    overview: {
      title: "Обзор",
      hint: "Распределение доменов и URL по всем запросам этого прогона.",
      engineGoogle: "Google",
      engineYandex: "Яндекс",
      engineSummary: (n: number) =>
        `${n} ${pluralRu(n, ["строка результата", "строки результата", "строк результата"])}`,
      domainsTitle: "Домены",
      urlsTitle: "URL",
      colDomain: "Домен",
      colUrl: "URL",
      colCount: "Кол-во",
      colAvgPos: "Ср. поз.",
      noneForEngine: "Нет строк по этому поисковику.",
      fullBreakdown: "Полный разбор →",
    },
  },
  overviewPage: {
    title: (id: number) => `Обзор — Запуск №${id}`,
    back: "← Назад к запуску",
    groupBy: "Группировать по",
    dimEngine: "Поисковик",
    dimGeo: "Гео",
    dimLanguage: "Язык",
    dimDevice: "Устройство",
    combinations: (n: number) =>
      `${n} ${pluralRu(n, ["комбинация", "комбинации", "комбинаций"])}`,
    allResults: "Все результаты",
    rowsInGroup: (n: number) =>
      `${n} ${pluralRu(n, ["строка", "строки", "строк"])}`,
    empty: "В этом запуске пока нет результатов.",
  },
  variantLabel: {
    google: "Google",
    yandex: "Яндекс",
    desktop: "Десктоп",
    mobile: "Мобильный",
    country: "страна",
    noGeo: "без гео",
  },
  settings: {
    title: "Настройки",
    intro:
      "Настройте учётные данные провайдеров и сохранённые локации.",
    addLocation: {
      title: "Добавить локацию",
      help: (
        <>
          <code>canonical_name</code> использует формат SerpAPI с разделителями-запятыми.{" "}
          <code>yandex_lr</code> — числовой ID региона Яндекса, нужен для
          городского таргетинга Яндекса (напр. Москва=213, Алматы=162, Ташкент=11353).
        </>
      ),
      phCanonical: "canonical_name",
      phName: "отображаемое имя",
      phCc: "cc (kz, uz…)",
      phType: "тип…",
      phYandexLr: "yandex_lr",
      typeOptions: {
        Country: "Страна",
        Region: "Регион",
        City: "Город",
        Other: "Другое",
      },
    },
    bulk: {
      title: "Массовый импорт",
      help: (
        <>
          По одной записи на строку. Колонки разделяются табуляцией или вертикальной
          чертой:
          <code> canonical_name | name | country_code | target_type | yandex_lr</code>.
          Обязательна только первая колонка. Дубликаты пропускаются автоматически.
        </>
      ),
      result: (added: number, skipped: number) =>
        `Добавлено: ${added}, пропущено: ${skipped} (дубликаты)`,
    },
    list: {
      heading: (n: number) => `Сохранённые локации (${n})`,
      perProviderHelp: (
        <>
          Что отправляется в каждый провайдер на основе строки:{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            SerpAPI
          </span>{" "}
          использует <code>location=canonical_name</code> и <code>gl=CC</code>.{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Bright Data Google
          </span>{" "}
          использует <code>gl=CC</code> и вычисленное <code>uule=</code> ниже.{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Oxylabs Google
          </span>{" "}
          использует <code>geo_location=canonical_name</code> (нечёткий поиск
          по собственной БД Oxylabs; при отсутствии города в их базе откатывается
          до уровня страны).{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Яндекс
          </span>{" "}
          (любой провайдер) использует <code>lr=yandex_lr</code>.
        </>
      ),
      cols: {
        canonical: "canonical_name",
        name: "Имя",
        cc: "CC",
        type: "Тип",
        yandexLr: "yandex_lr",
        uule: "uule (Bright Data Google)",
      },
      empty: "Локации не найдены.",
      deleteConfirm: "Удалить эту локацию?",
      copyUuleTitle: "Скопировать полный UULE",
    },
    rates: {
      title: "Стоимость запросов",
      help:
        "Сколько вы платите за один запрос у каждого провайдера. Используется для расчёта стоимости в форме задачи и для прогонов, где провайдер не возвращает реальную цену. Ставки зависят от вашего тарифа — укажите свои.",
      usingDefault: "значение по умолчанию",
      defaultIs: (v: string) => `по умолчанию: $${v}`,
      footnote:
        "DataForSEO возвращает реальную стоимость каждого запроса, поэтому его прогоны записывают фактические траты и эту ставку игнорируют. SerpAPI, Bright Data и Oxylabs цену не возвращают — их прогоны считаются по ставке выше. Очистите поле, чтобы вернуть значение по умолчанию.",
    },
    providers: {
      title: "Провайдеры",
      configured: "настроено",
      partial: "частично",
      notSet: "не задано",
      savedSecret: (last4: string, length: number) => (
        <>
          Сохранено: <code>••••{last4}</code> ({length} симв.)
        </>
      ),
      savedPlain: (value: string) => (
        <>
          Сохранено: <code>{value}</code>
        </>
      ),
      savedNoDetail: "Сохранено.",
      worksOk: (provider: string) => `✓ ${provider} работает.`,
      plan: (plan: string) => (
        <>
          {" "}Тариф: <strong>{plan}</strong>.
        </>
      ),
      searchesLeft: (n: number) => (
        <>
          {" "}Осталось запросов: <strong>{n}</strong>.
        </>
      ),
      balance: (n: number) => (
        <>
          {" "}Баланс: <strong>${n}</strong>.
        </>
      ),
      clearConfirm: (provider: string) =>
        `Очистить все сохранённые учётные данные для ${provider}?`,
      meta: {
        serpapi: {
          help: "Провайдер по умолчанию. Получите ключ на serpapi.com/manage-api-key. Значение в БД переопределяет SERPAPI_KEY из .env.",
          api_key: { label: "API-ключ", placeholder: "Вставьте ключ SerpAPI…" },
        },
        brightdata: {
          help:
            "Рекомендуем две зоны: `zone` с типом Full JSON для Google и `zone_raw` с типом Raw HTML для Яндекса (парсер Full JSON Bright Data на большинстве тарифов не покрывает Яндекс, поэтому мы получаем страницу и парсим её сами). Если нужен только Google, оставьте `zone_raw` пустым.",
          token: {
            label: "API-токен",
            placeholder: "Bearer-токен из панели Bright Data",
          },
          zone: {
            label: "Зона (Full JSON, для Google)",
            placeholder: "напр. serp_api1",
          },
          zone_raw: {
            label: "Зона (Raw HTML, для Яндекса) — необязательно",
            placeholder: "напр. serp_raw",
          },
        },
        oxylabs: {
          help: "SERP Scraper API на realtime.oxylabs.io. Используйте имя пользователя и пароль из суб-аккаунта Oxylabs SERP Scraper.",
          username: {
            label: "Имя пользователя",
            placeholder: "Имя пользователя Oxylabs SERP",
          },
          password: { label: "Пароль", placeholder: "Пароль Oxylabs" },
        },
        dataforseo: {
          help:
            "Только Google — у DataForSEO нет эндпоинта для Яндекса. Режим Live (~$0.002 за запрос, результат за несколько секунд). Учётные данные — на app.dataforseo.com/api-access; API-пароль генерируется автоматически и НЕ совпадает с паролем от аккаунта. Проверка бесплатна (запрашивает баланс, не тратя кредиты).",
          login: { label: "Логин (email)", placeholder: "you@example.com" },
          password: { label: "API-пароль", placeholder: "Сгенерированный API-пароль" },
        },
      },
    },
  },
  combobox: {
    searching: "Поиск…",
    noMatches: "Ничего не найдено.",
  },
  cost: {
    estimated: "оц.",
    actualHint: "Фактическая стоимость, полученная от провайдера",
    estimateHint: "Оценка: количество запросов × ставка из «Настроек»",
  },
};

const messages = { en: messagesEn, ru: messagesRu };

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Messages;
};

const LangContext = createContext<Ctx | null>(null);

export function LangProvider({
  children,
  initial = "en",
}: {
  children: ReactNode;
  initial?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initial);

  // Re-sync from DOM after mount: the pre-paint script in <html> has already
  // set `<html lang>` from localStorage by the time React hydrates, so we
  // just read it back instead of touching localStorage twice.
  useEffect(() => {
    const fromHtml = document.documentElement.lang;
    if (fromHtml === "ru" || fromHtml === "en") {
      setLangState(fromHtml);
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
    document.documentElement.lang = l;
  }, []);

  const value: Ctx = { lang, setLang, t: messages[lang] };
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT(): Ctx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useT must be used inside <LangProvider>");
  return ctx;
}
