# SERP Monitor

Single-user internal tool for brand-protection SERP scraping across **Google + Yandex** with three interchangeable providers (SerpAPI, Bright Data, Oxylabs), bilingual UI (English / Russian), and built-in scheduling.

## What it does

- **Bulk-paste up to 100 keywords per job.**
- **Cartesian-product scrape** across:
  - **Engines** — Google, Yandex (multi-select)
  - **Devices** — Desktop, Mobile (multi-select)
  - **Locations** — country / region / city, blending your **saved locations** (★) with **live SerpAPI** search results in the picker
  - **Languages** (multi-select)
  - **Google domains** — `google.kz`, `google.com.tr`, etc. (optional, falls back to country default)
- **Three providers**, switchable per job: SerpAPI, Bright Data, Oxylabs. Each has its own credentials section in Settings with a "Test" button.
- **Bright Data Yandex** is parsed from raw HTML by our own extractor (most plans don't ship a Yandex JSON parser).
- **Oxylabs Yandex** uses the `universal` source with a manually-built URL (their `yandex_search` source was decommissioned).
- **Yandex city-level targeting** via `lr=<region_id>` — the saved-locations table holds these IDs, with ~30 CIS/Eurasia cities seeded on first boot.
- **Google city-level targeting** via `uule=` (we encode it in-app from `canonical_name`) for Bright Data, `location=` for SerpAPI, `geo_location=` for Oxylabs.
- **Save / rename / delete / rerun** jobs.
- **Schedule** any job on a cron — schedules survive restarts via `SQLAlchemyJobStore`; missed schedules backfill on wake-up.
- **Verify Scraped Queries** panel on the run page — clickable browser-equivalent URLs (`?q=...&gl=...&hl=...&uule=...` for Google, `?text=...&lr=...&lang=...` for Yandex) so you can confirm targeting visually.
- **Per-run CSV export** with a top-N cap; copy individual keywords or the whole run to clipboard as TSV.
- **Live cost estimate** before you hit Run, plus a hard-cap (`MAX_QUERIES_PER_RUN`) as a safety belt.
- **Effective-targeting panel** on the job form: tells you per location × engine whether you'll get city-level, country-level, or no geo, and warns inline if a Yandex location is missing `yandex_lr`.
- **Bilingual UI** — English and Russian, EN/RU pill toggle in the header, persisted in localStorage with a pre-paint script (no flash on reload).
- **Full Russian documentation** at `/docs` covering setup, providers, locations, cron, and result verification.
- **Light / dark theme toggle.**

## Stack

- **Backend:** FastAPI + SQLAlchemy + SQLite + APScheduler + httpx + selectolax
- **Frontend:** Next.js 16 (app router, Turbopack) + React 19 + Tailwind + cmdk + lucide-react
- **Reverse proxy:** Caddy (auto-HTTPS for real domains, optional basic auth)
- **Container:** Docker Compose, three services (`api`, `web`, `caddy`); both runtime containers run as non-root users

Single-user means no auth UI inside the app — protect it at Caddy with basic auth, or run behind your VPN / firewall.

## Requirements

- Docker + Docker Compose
- A SerpAPI / Bright Data / Oxylabs account (or all three) — pick at least one. Each can be configured in the **Settings** page after deploy without touching `.env`.
- A VPS or local machine

## Deploy

```bash
git clone <this-repo> serp-monitor
cd serp-monitor
cp .env.example .env
$EDITOR .env                    # set ports; SerpAPI key is optional here (UI takes precedence)
docker compose up -d --build
```

Open the UI at `http://localhost:8080`. Default port is **8080** because Windows often reserves port 80; on Linux/macOS you can switch to 80.

For a real domain over HTTPS:

```bash
# in .env
SITE_HOST=monitor.example.com
HTTP_PORT=80
HTTPS_PORT=443
```

Point DNS at your VPS — Caddy issues a Let's Encrypt cert automatically on first request.

### Optional: basic auth at the Caddy layer

Recommended whenever this tool is reachable beyond your VPN. The `Caddyfile` ships with the `basic_auth` block commented out — open the file and follow the inline instructions, plus set in `.env`:

```bash
BASIC_AUTH_USER=admin
BASIC_AUTH_PASSWORD_HASH=$$2a$$14$$...      # doubled $$ to escape Docker interpolation
```

Generate the hash without leaking plaintext to your shell history:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'yourpass'
```

Then `docker compose up -d --force-recreate caddy`.

## Settings page (`/settings`)

Three sections:

1. **Providers** — three independent cards (SerpAPI, Bright Data, Oxylabs), each with a **Save / Test / Clear** trio. The DB values override anything in `.env`. Tests don't burn search credits where the provider has a separate `/account` endpoint.
2. **Add a location** — single-entry form for SerpAPI canonical names like `Almaty,Almaty Province,Kazakhstan`. Includes a `yandex_lr` field for Yandex city-level targeting.
3. **Bulk import** — paste many at once, one per line, columns separated by `|` or tabs.

The **job form's location picker** automatically merges your saved locations (★) with live SerpAPI results. CIS/Eurasia cities (KZ/UZ/KG/etc.) often have thin Google Ads geotargeting data in SerpAPI's database — saved locations let you curate the gaps with verified `yandex_lr` values.

On first boot the DB is seeded with ~30 common CIS/Eurasia locations, but **only their `yandex_lr` is filled if NULL** — your manual edits are never overwritten.

## Bilingual UI

Two-language toggle in the header (EN / RU). Default is English; choice is persisted in `localStorage.lang` and applied via a pre-paint script in `<head>`, so reloading never flashes the wrong language.

The Russian documentation page (`/docs`) is the same regardless of UI language — a single comprehensive guide covering setup, providers, locations, cron, and how to verify scraped results manually. Linked from the header in both languages.

## Scheduling

Each job has an optional cron expression and an "Enabled" toggle.

- The scheduler runs **in UTC by default** (visible on the form's helper text). To change, edit `backend/app/scheduler.py` `timezone="UTC"` → e.g. `"Asia/Almaty"`, then `docker compose restart api`.
- Cron format is `minute hour day month dow`. Tester: <https://crontab.guru/>.
- One-click presets in the form: hourly, every 6h, daily 06:00, daily 09:00 + 21:00, weekdays 08:00. The `/docs` page lists ~15 more.
- The **job overview page** shows next-run time, computed by APScheduler and rendered in your local timezone. If the cron didn't register (invalid expression), you'll see a warning instead of a date.
- **Missed runs backfill** when the host wakes up. With `misfire_grace_time=None` and `coalesce=True`, if your laptop sleeps overnight, you get one run on wake — not zero, not twelve.
- On startup any run still marked `running` is auto-marked `failed` (parent process died mid-run); just hit Rerun.
- **Bad cron expressions return a 400 with a hint** instead of being saved silently.

## Cost control

- Live estimate of provider calls per run, updated as you tweak the form.
- Hard cap per run via `MAX_QUERIES_PER_RUN` in `.env` (default 2000).
- Backend dedupes identical (keyword × engine × device × location × language × google_domain) tuples before dispatch, so live estimate may overshoot actual count slightly.

## Verifying scraped results

The run page has a **"Verify scraped queries"** collapsible. It lists each unique `(keyword × variant)` and shows the human-readable URL the search engine itself accepts — provider-specific noise (`brd_json`, `parse`, `source`, …) is stripped.

Click any URL: you'll see exactly what Google or Yandex would show. Compare top-3 visible results against the group results in our system — small drift is normal (personalization), large drift is a signal that gear is misconfigured.

For Yandex check `lr=`, `lang=`, and the domain (`yandex.ru` / `yandex.kz` / …). For Google check `gl=`, `hl=`, and `uule=` (or the absence of it = country-level only). Mobile vs desktop URLs look identical — both engines drive mobile via User-Agent; switch UA in Chrome DevTools (`Ctrl+Shift+M`) to verify mobile scrapes.

Full step-by-step guide in `/docs` → "Проверка корректности".

## Result view

Results are grouped by keyword, then by variant (engine · device · location · language). Color coding is **per-axis**, not per-row:

| Axis | Color |
|---|---|
| Keyword (group header) | Blue |
| Engine | Violet |
| Device | Emerald |
| Country / location | Amber |
| Language | Rose |

So when two adjacent rows differ only by device, the only chip color that changes is emerald — visually scannable for "what differs".

## Export filename

```
<job-slug>_DD-MM-YYYY_H.MM.SS-AM/PM_run<id>_top<N>.csv
```

e.g. `brand-monitoring-kz-ru_03-05-2026_4.05.25-PM_run42_top5.csv`. Timestamp is the run's `started_at` in UTC; date is DD-MM-YYYY.

## Project layout

```
serp-monitor/
├── backend/
│   ├── Dockerfile           non-root user, python:3.12-slim
│   ├── requirements.txt
│   └── app/
│       ├── main.py              lifespan: create_all, sqlite migrations,
│       │                        seed locations, backfill yandex_lr, reload schedules
│       ├── config.py            pydantic-settings env loader
│       ├── db.py                SQLAlchemy session factory
│       ├── models.py            Job, JobRun, Result, SavedLocation, AppSetting
│       ├── schemas.py           Pydantic in/out
│       ├── tasks.py             cartesian expansion + run executor
│       ├── scheduler.py         APScheduler + SQLAlchemyJobStore
│       ├── app_settings.py      DB-backed runtime creds
│       ├── data/
│       │   ├── languages.json
│       │   ├── google_domains.json
│       │   └── seed_locations.json    ~30 CIS/Eurasia locs with yandex_lr
│       ├── providers/
│       │   ├── base.py             SerpProvider ABC + ProviderError + ProviderConfigError
│       │   ├── serpapi.py          SerpAPIProvider + search_serpapi_locations
│       │   ├── brightdata.py       Google via brd_json=1, Yandex via raw HTML zone
│       │   ├── oxylabs.py          google_search source for Google,
│       │   │                       universal source + raw HTML for Yandex
│       │   ├── yandex_html.py      strict parse_yandex_html (selectolax)
│       │   └── uule.py             google_uule encoder for Bright Data Google
│       └── routers/
│           ├── jobs.py          CRUD + estimate + run + schedule-info
│           ├── runs.py          get + results + delete
│           ├── export.py        CSV with top-N cap
│           ├── locations.py     /lookup/* + saved-locations CRUD
│           └── settings.py      /settings/api-key + provider creds + scheduler info
├── frontend/                    Next.js 16 (Turbopack) + React 19
│   ├── Dockerfile           multi-stage, non-root `node` user in runner
│   ├── app/
│   │   ├── layout.tsx           pre-paint script (theme + lang) + LangProvider
│   │   ├── globals.css          class-based dark mode
│   │   ├── page.tsx             jobs list
│   │   ├── jobs/new/page.tsx
│   │   ├── jobs/[id]/page.tsx
│   │   ├── runs/[id]/page.tsx       verify-queries + grouped results
│   │   ├── settings/page.tsx        provider cards + saved-locations table
│   │   └── docs/page.tsx            Russian documentation (single page, anchored ToC)
│   ├── components/
│   │   ├── job-form.tsx         large form + EffectiveTargetingPanel + cost estimate
│   │   ├── multi-combobox.tsx       generic multi-select (cmdk-based)
│   │   ├── theme-toggle.tsx
│   │   ├── language-toggle.tsx
│   │   └── header-shell.tsx
│   └── lib/
│       ├── api.ts               typed API client
│       ├── i18n.tsx             en/ru dict + LangProvider + useT() hook
│       ├── uule.ts              JS port of providers/uule.py for inline preview
│       └── browser-urls.ts      reconstruct user-facing Google/Yandex URLs
├── docker-compose.yml
├── Caddyfile                    optional basic_auth block (commented by default)
├── .env.example
└── data/                        SQLite DB lives here (Docker volume target /data)
```

## Local dev (without Docker)

Backend:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate    # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
export DATABASE_URL=sqlite:///./serp.db
uvicorn app.main:app --reload --port 8000
```

Frontend:
```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```

Open <http://localhost:3000>.

## Troubleshooting

- **Yandex empty / captcha** — provider hit a rate limit. Wait, then rerun. For Bright Data check that `zone_raw` is active. For Oxylabs check that the SERP-Scraper sub-account creds are correct (not the main account).
- **`ProviderConfigError` at run start** — most often: Bright Data + Yandex with no `zone_raw` set; or expired SerpAPI key. Open Settings → check the relevant provider card.
- **Schedule didn't fire** — verify the "Enabled" checkbox is on, the job is saved, and the job-page schedule block shows "Next run: …". If it shows "⚠ not registered with scheduler", toggle the checkbox off/on and save again.
- **Build cache stale on rebuild** — Docker BuildKit on Windows occasionally caches the `COPY . .` layer past real changes. If a fresh `docker compose up -d --build` doesn't pick up edits, run a hard rebuild:
  ```bash
  docker compose stop web && docker compose rm -f web
  docker compose build --no-cache web
  docker compose up -d web
  ```
  Verify with `docker compose exec web sh -c "grep -rl 'some-string-from-your-edit' .next/server"`.

## Notes / known limitations

- **Yandex device emulation via SerpAPI** is desktop-only on most plans. The `device` value is recorded for tagging; the request itself doesn't differ. For mobile Yandex, route through Bright Data or Oxylabs.
- **Yandex region IDs may be wrong** for CIS cities outside Russia (Tashkent was originally seeded as `11353`; user-verified is `10335`). The UI is the source of truth — your edits stick across deploys.
- **Authentication** is single basic-auth at the Caddy layer (optional). Multi-user is out of scope.
- **Result diff across runs** isn't built. Every run is its own snapshot; "what changed since last run" isn't a feature yet.
- **Yandex DOM drift** — if Yandex changes their SERP markup, the strict parser returns 0 rows and logs `html_len + title` for diagnosis. Update selectors in `providers/yandex_html.py` if needed.

## License

Internal use only — see [`LICENSE`](./LICENSE).
