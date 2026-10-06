"""Which locations a SERP provider can actually search.

Why this exists (user, 2026-10-05): "I chose Almaty for DataForSEO and got an
error that the location is not supported … when the provider is chosen, we
should display only the locations of this provider."

The job form's picker searched SerpAPI's location list for every provider, on
the belief — written into dataforseo.py — that DataForSEO's `location_name`
takes the same names. Measured, it does not. Both lists come from Google's
geo-targets, but from different vintages: SerpAPI still serves
"Almaty,Almaty Province,Kazakhstan" (alongside the newer "…Almaty Region…"),
DataForSEO only "Almaty,Almaty Region,Kazakhstan", and it refuses a name it
does not have. What the two DO share is Google's geo-target ID: SerpAPI's
`google_id` 9063099 is DataForSEO's `location_code` 9063099.

So:

* DataForSEO's whole list (free endpoint, ~270k places) is mirrored into its
  OWN SQLite file beside the main database, and refreshed every
  SYNC_EVERY_DAYS. Its own file, because writing 270k rows holds a write lock
  for seconds: in the main database that made every other request — a running
  job's inserts included — fail with "database is locked" (measured on the
  first build, 2026-10-05). A cache must never be able to do that.
* A job's location is matched to it BY ID wherever an ID can be had: stored on
  the job when it was picked, stored on the saved location, or asked of SerpAPI
  (whose list knows the ID of every name it has ever served). Names decide only
  where they cannot mislead — see `choose`.
* DataForSEO is then asked by `location_code`, never by name.

What the mirror says no to is real: DataForSEO has no Russia or Belarus at all,
and no city entry for Bukhara or Samarkand (measured 2026-10-05).

Then (user, same day): "add all the locations for Bright Data, Oxylabs and
DataForSEO". Bright Data and Oxylabs have no list of their own to publish:
both document Google's geo-targets CSV as THE list — Bright Data takes its
"Canonical Name" as `uule`, Oxylabs takes the canonical name or the Criteria
ID as `geo_location`. So that file (273,666 places, the newest dated one on
Google's page) is mirrored too, as list "google", and LIST_OF says which list
each provider's locations come from. Neither refuses an unknown name: Google
just ignores it and answers for the country — which is why Bukhara and
Samarkand, cities in no list at all, had been searching country-wide unnoticed.

SerpAPI is the one provider with no mirror: the live picker IS a search of its
own list, the only place its spellings can be had.
"""
from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, timezone
from typing import NamedTuple

import httpx
from sqlalchemy import Index, Integer, String, Text, UniqueConstraint, create_engine, event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from ._redact import redact
from .app_settings import get_provider_creds
from .config import settings
from .db import IS_SQLITE, SessionLocal
from .db import engine as main_engine
from .models import SavedLocation

log = logging.getLogger(__name__)

SYNC_EVERY_DAYS = 30
DFS_LOCATIONS_URL = "https://api.dataforseo.com/v3/serp/google/locations"
SERPAPI_LOCATIONS_URL = "https://serpapi.com/locations.json"
#: Google publishes the file under a dated name; the page lists the current ones.
GOOGLE_GEOTARGETS_PAGE = "https://developers.google.com/google-ads/api/data/geotargets"
_GOOGLE_FILE = re.compile(r"/static/google-ads/api/data/geo/geotargets-(\d{4}-\d{2}-\d{2})\.csv\.zip")
_sync_lock = threading.Lock()

#: The mirrored list each provider's locations come from. A provider missing
#: here has none (SerpAPI: its list is its live search; own_android: imported).
LIST_OF = {"dataforseo": "dataforseo", "brightdata": "google", "oxylabs": "google"}


def lists_for(providers: list[str]) -> list[str]:
    """The distinct lists a job's providers need, in a stable order."""
    return sorted({LIST_OF[p] for p in providers if p in LIST_OF})


def _stamp_key(list_name: str) -> str:
    return f"provider_locations_synced__{list_name}"

#: Broad places first in a search, postal codes last: someone typing "Almaty"
#: wants the city, not a district or a postcode that contains the word.
_TYPE_RANK = {"country": 0, "region": 1, "province": 1, "state": 1, "city": 2, "municipality": 3,
              "district": 4, "county": 4, "neighborhood": 6, "postal code": 9}

#: Words a region's name gains and loses between vintages of Google's list
#: ("Almaty Province" became "Almaty Region") without the region changing.
_REGION_WORDS = re.compile(r"\b(province|region|oblast|state|district|territory|krai|county|prefecture|governorate)\b")


# --------------------------------------------------------------------------
# The mirror's own database
# --------------------------------------------------------------------------

class MirrorBase(DeclarativeBase):
    pass


class ProviderLocation(MirrorBase):
    """One place in a provider's own location list. `code` is Google's
    geo-target ID: DataForSEO's location_code, SerpAPI's google_id."""
    __tablename__ = "provider_locations"
    # One index per lookup, each LED by provider, and NO index on provider
    # alone: every row has the same provider, and with such an index to hand
    # SQLite used it for the name lookup and read all 270k rows (measured:
    # 1.2 s per location not found by ID, 11 s to filter the saved list).
    __table_args__ = (
        UniqueConstraint("provider", "code", name="uq_provider_location"),
        Index("ix_pl_name", "provider", "name_lc"),
        Index("ix_pl_place", "provider", "country_code", "head"),
        Index("ix_pl_head", "provider", "head"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(40))
    code: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(300))
    # Lower-cased copy: `lower(name) = ?` cannot use an index.
    name_lc: Mapped[str] = mapped_column(String(300))
    #: First part of the name ("almaty"): how same-named places are found.
    head: Mapped[str] = mapped_column(String(200))
    country_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    location_type: Mapped[str | None] = mapped_column(String(40), nullable=True)


class MirrorMeta(MirrorBase):
    """When each provider's list was last downloaded. Kept WITH the list, so a
    deleted mirror file never leaves a "fresh" stamp behind."""
    __tablename__ = "mirror_meta"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)


if IS_SQLITE:
    # Beside the main database file: /data/serp.db → /data/provider_locations.db
    _main_path = settings.database_url.split("sqlite:///", 1)[1]
    _mirror_url = "sqlite:///" + _main_path.rsplit("/", 1)[0] + "/provider_locations.db"
    mirror_engine = create_engine(_mirror_url, connect_args={"check_same_thread": False})

    @event.listens_for(mirror_engine, "connect")
    def _mirror_wal(dbapi_connection, _record):
        # Readers keep reading the old list while a refresh writes the new one.
        dbapi_connection.execute("PRAGMA journal_mode=WAL")
else:
    mirror_engine = main_engine          # a server database has no file lock to share
_Session = sessionmaker(bind=mirror_engine, autoflush=False, autocommit=False)
_schema_lock = threading.Lock()
_schema_ready = False


def _ensure_schema() -> None:
    """Create the mirror's tables the first time it is used — not at import.
    Every provider imports this module, and importing must not need the data
    directory: where only the tests run (CI) there is none, and the import
    itself failed with "unable to open database file"."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        MirrorBase.metadata.create_all(bind=mirror_engine)
        if IS_SQLITE:
            # A mirror file made before the indexes above existed: create_all
            # adds no index to a table that is already there, so bring it in
            # line here.
            with mirror_engine.begin() as conn:
                for old in ("provider", "code", "name_lc", "head", "country_code"):
                    conn.execute(text(f"DROP INDEX IF EXISTS ix_provider_locations_{old}"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pl_name ON provider_locations (provider, name_lc)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pl_place ON provider_locations (provider, country_code, head)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pl_head ON provider_locations (provider, head)"))
        _schema_ready = True


def MirrorSession() -> Session:
    """A session on the mirror, with its tables in place."""
    _ensure_schema()
    return _Session()


class Loc(NamedTuple):
    code: int
    name: str
    country_code: str | None
    location_type: str | None


def _loc(row: ProviderLocation) -> Loc:
    return Loc(row.code, row.name, row.country_code, row.location_type)


# --------------------------------------------------------------------------
# Pure: which mirrored place a job's location IS, when only names can say.
# Kept apart from the queries so the rule is tested without a database.
# --------------------------------------------------------------------------

def head_of(name: str | None) -> str:
    """"Almaty" of "Almaty,Almaty Province,Kazakhstan", lower-cased."""
    return (name or "").split(",")[0].strip().lower()


def region_key(name: str | None) -> str:
    """What sits between the place and its country, without the words that
    vintages disagree on: "almaty" for both "…,Almaty Province,…" and
    "…,Almaty Region,…"; "" when there is nothing between them."""
    middle = " ".join(p.strip().lower() for p in (name or "").split(",")[1:-1])
    return " ".join(_REGION_WORDS.sub(" ", middle).split())


def choose(ref: dict, same_place: list[Loc]) -> Loc | None:
    """The provider's entry for this location among `same_place` — every entry
    in the location's country whose first name part equals the location's — or
    None when the names do not single one out.

    One entry of the location's type is it. Several are told apart only by
    their region saying the same thing ("Almaty,Almaty Region,Kazakhstan" for a
    job's "Almaty,Almaty Province,Kazakhstan", not "Almaty,Kazakhstan"). Past
    that it refuses: two Springfields in one country are not the same place,
    and searching the wrong one would look exactly like success.
    """
    want = (ref.get("target_type") or "").casefold()
    pool = [c for c in same_place if (c.location_type or "").casefold() == want] if want else list(same_place)
    if len(pool) == 1:
        return pool[0]
    key = region_key(ref.get("canonical_name"))
    same_region = [c for c in pool if region_key(c.name) == key]
    return same_region[0] if len(same_region) == 1 else None


def pick_serpapi_id(ref: dict, exact_rows: list[dict], head_rows: list[dict]) -> int | None:
    """Google's ID for a location, from what SerpAPI's list answered.

    `exact_rows` came back for the location's full name: a row carrying that
    very name is it. A name SerpAPI no longer serves ("Shymkent,South
    Kazakhstan Province,Kazakhstan") gets nothing there, so `head_rows` — the
    answer for "Shymkent" alone — decides, and only when exactly one row is
    that place by name, country and type.
    """
    name = (ref.get("canonical_name") or "").strip().lower()
    want = (ref.get("target_type") or "").casefold()
    for r in exact_rows:
        # Same name AND same kind of place: "Moscow,Russia" the region is not
        # "Moscow,Russia" the city some list once called by that name.
        if ((r.get("canonical_name") or "").strip().lower() == name and r.get("google_id")
                and (not want or (r.get("target_type") or "").casefold() == want)):
            return r["google_id"]
    head = head_of(name)
    country = (ref.get("country_code") or "").lower()
    hits = {
        r["google_id"] for r in head_rows
        if r.get("google_id") and head_of(r.get("canonical_name")) == head
        and country and (r.get("country_code") or "").lower() == country
        and (not want or (r.get("target_type") or "").casefold() == want)
    }
    return hits.pop() if len(hits) == 1 else None


# --------------------------------------------------------------------------
# Asking SerpAPI for an ID (free endpoint). Answers are remembered for the
# life of the process, misses included, so a location is asked about once.
# --------------------------------------------------------------------------

_serpapi_ids: dict[str, int | None] = {}


def serpapi_google_id(ref: dict) -> int | None:
    name = (ref.get("canonical_name") or "").strip()
    if not name:
        return None
    key = f"{name.lower()}|{(ref.get('country_code') or '').lower()}|{(ref.get('target_type') or '').lower()}"
    if key in _serpapi_ids:
        return _serpapi_ids[key]
    try:
        with httpx.Client(timeout=15) as c:
            exact = c.get(SERPAPI_LOCATIONS_URL, params={"q": name, "limit": 20}).json()
            found = pick_serpapi_id(ref, exact if isinstance(exact, list) else [], [])
            if found is None:
                head = c.get(SERPAPI_LOCATIONS_URL, params={"q": name.split(",")[0].strip(), "limit": 50}).json()
                found = pick_serpapi_id(ref, [], head if isinstance(head, list) else [])
    except Exception as e:  # noqa: BLE001 - no answer is not "no such place": do not remember it
        log.warning("SerpAPI location lookup failed for %r: %s", name, redact(str(e)))
        return None
    _serpapi_ids[key] = found
    return found


# --------------------------------------------------------------------------
# The mirror
# --------------------------------------------------------------------------

def _by_code(m: Session, provider: str, code: int | None) -> Loc | None:
    if not code:
        return None
    row = m.query(ProviderLocation).filter(
        ProviderLocation.provider == provider, ProviderLocation.code == code).first()
    return _loc(row) if row else None


def resolve(db: Session, provider: str, ref: dict, *, ask_serpapi: bool = True) -> Loc | None:
    """The provider's own entry for a job's location, or None if it has none.

    `db` is the MAIN database (saved locations); the mirror is opened here.
    `ref` is a LocationRef as stored on a job. In order: the ID stored with it;
    the ID stored on the saved location of the same name; the exact name; the
    country's own entry for a country; a name match that cannot mislead
    (`choose`); and last the ID SerpAPI gives for the name (one or two free
    requests, remembered).
    """
    name = (ref.get("canonical_name") or "").strip()
    saved = db.query(SavedLocation.google_id).filter(SavedLocation.canonical_name == name).first() if name else None
    with MirrorSession() as m:
        found = _by_code(m, provider, ref.get("google_id")) or _by_code(m, provider, saved[0] if saved else None)
        if found or not name:
            return found
        q = m.query(ProviderLocation).filter(ProviderLocation.provider == provider)
        row = q.filter(ProviderLocation.name_lc == name.lower()).first()
        if row:
            return _loc(row)
        country = (ref.get("country_code") or "").strip().upper()
        if country:
            if (ref.get("target_type") or "").casefold() == "country":
                # "Turkey" is "Turkiye" there: a country is its ISO code, not a spelling.
                row = q.filter(ProviderLocation.country_code == country,
                               ProviderLocation.location_type == "Country").first()
                return _loc(row) if row else None
            same = q.filter(ProviderLocation.country_code == country,
                            ProviderLocation.head == head_of(name)).limit(200).all()
            found = choose(ref, [_loc(r) for r in same])
            if found:
                return found
        if ask_serpapi:
            return _by_code(m, provider, serpapi_google_id(ref))
    return None


def rank(needle: str, loc: Loc, reach: dict[int, int] | None = None) -> tuple:
    """Search order (pure): the place NAMED what was typed first — "Almaty"
    the city before "Almaty Region" and before every town inside it — then
    broader kinds of place before narrower, then the bigger place before its
    namesakes, then shorter names.

    `reach` is SerpAPI's audience figure per Google ID, when the caller has
    it: Google's own list says nothing about size, and without it "Paris" put
    Paris, Idaho ahead of Paris, France."""
    head = head_of(loc.name)
    return (head != needle, _TYPE_RANK.get((loc.location_type or "").lower(), 5),
            -((reach or {}).get(loc.code) or 0),
            not head.startswith(needle), len(loc.name), loc.name)


def search(provider: str, text: str, limit: int = 20, reach: dict[int, int] | None = None) -> list[Loc]:
    """Places in a mirrored list matching `text`, best first.

    Places whose OWN name starts with the text are fetched first, through the
    index — never left to chance. A plain "name contains" query returns its
    first few hundred matches in alphabetical order, and for "Paris" those are
    postal codes ("75001,Paris,…"): the city itself came after the cut.
    Matches elsewhere in the name (a city listed under its region) only fill
    up what is left.
    """
    needle = text.strip().lower().replace("%", "").replace("_", " ")
    if not needle:
        return []
    with MirrorSession() as m:
        base = m.query(ProviderLocation).filter(ProviderLocation.provider == provider)
        found = {r.code: _loc(r) for r in base.filter(
            ProviderLocation.head >= needle, ProviderLocation.head < needle + "\uffff").limit(800).all()}
        if len(found) < limit:
            for r in base.filter(ProviderLocation.name_lc.like(f"%{needle}%")).limit(400).all():
                found.setdefault(r.code, _loc(r))
    return sorted(found.values(), key=lambda loc: rank(needle, loc, reach))[:limit]


def codes_present(provider: str, codes: list[int]) -> set[int]:
    if not codes:
        return set()
    with MirrorSession() as m:
        return {c for (c,) in m.query(ProviderLocation.code)
                .filter(ProviderLocation.provider == provider, ProviderLocation.code.in_(codes)).all()}


def _load_dataforseo() -> list[dict] | None:
    """DataForSEO's current list; None when no credentials are configured
    (nothing to ask with). Raises on a failed download."""
    creds = get_provider_creds("dataforseo")
    if not creds.get("login") or not creds.get("password"):
        return None
    r = httpx.get(DFS_LOCATIONS_URL, auth=(creds["login"], creds["password"]), timeout=240)
    r.raise_for_status()
    payload = r.json()
    task = (payload.get("tasks") or [{}])[0] or {}
    # DataForSEO answers HTTP 200 on logical failures; the outcome is status_code.
    if payload.get("status_code") != 20000 or task.get("status_code") != 20000:
        raise RuntimeError(redact(f"DataForSEO locations: {task.get('status_message') or payload.get('status_message')}"))
    return [
        {"code": it.get("location_code"), "name": it.get("location_name"),
         "country_code": it.get("country_iso_code"), "location_type": it.get("location_type")}
        for it in task.get("result") or []
    ]


def latest_geotargets_url(page_html: str) -> str | None:
    """The newest dated geo-targets file linked from Google's page (pure)."""
    dates = sorted(set(_GOOGLE_FILE.findall(page_html)))
    if not dates:
        return None
    return f"https://developers.google.com/static/google-ads/api/data/geo/geotargets-{dates[-1]}.csv.zip"


def parse_geotargets(csv_text: str) -> list[dict]:
    """Rows of Google's geo-targets CSV (pure). Places Google has marked
    "Removal Planned" are kept: they are still searchable until they go."""
    import csv
    import io
    return [
        {"code": int(r["Criteria ID"]), "name": r["Canonical Name"],
         "country_code": r.get("Country Code"), "location_type": r.get("Target Type")}
        for r in csv.DictReader(io.StringIO(csv_text))
        if (r.get("Criteria ID") or "").isdigit() and r.get("Canonical Name")
    ]


def _load_google() -> list[dict]:
    """Google's geo-targets: the list Bright Data and Oxylabs both point to.
    Public, no credentials. Raises on a failed download."""
    import io
    import zipfile
    with httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as c:
        url = latest_geotargets_url(c.get(GOOGLE_GEOTARGETS_PAGE).text)
        if not url:
            raise RuntimeError("no geo-targets file is linked from Google's page")
        blob = c.get(url)
        blob.raise_for_status()
    archive = zipfile.ZipFile(io.BytesIO(blob.content))
    return parse_geotargets(archive.read(archive.namelist()[0]).decode("utf-8-sig"))


_LOADERS = {"dataforseo": _load_dataforseo, "google": _load_google}


def sync(m: Session, list_name: str) -> int:
    """Replace one mirrored list with its source's current one. 0 when the
    source cannot be asked yet (DataForSEO without credentials). Raises on a
    failed download — the caller keeps whatever list it already had."""
    loaded = _LOADERS[list_name]()
    if loaded is None:
        return 0
    seen: dict[int, dict] = {}
    for it in loaded:
        code, name = it.get("code"), it.get("name")
        if isinstance(code, int) and name:
            seen[code] = {
                "provider": list_name, "code": code, "name": name, "name_lc": name.lower(),
                "head": head_of(name), "country_code": (it.get("country_code") or "").upper() or None,
                "location_type": it.get("location_type"),
            }
    if not seen:
        raise RuntimeError(f"the {list_name} location list came back empty")
    m.query(ProviderLocation).filter(ProviderLocation.provider == list_name).delete(synchronize_session=False)
    rows = list(seen.values())
    # Core executemany, not ORM objects: 270k rows in seconds rather than half a minute.
    table = ProviderLocation.__table__
    for i in range(0, len(rows), 50_000):
        m.execute(table.insert(), rows[i:i + 50_000])
    m.merge(MirrorMeta(key=_stamp_key(list_name), value=datetime.now(timezone.utc).isoformat()))
    m.commit()
    log.info("mirrored %d %s locations", len(rows), list_name)
    return len(rows)


def ensure_synced(list_name: str = "dataforseo") -> bool:
    """True when there is a list to check locations against.

    Downloads it when there is none, or when the one here is older than
    SYNC_EVERY_DAYS. A refresh that fails keeps the old list; no list at all
    (no credentials yet, or the first download failed) is False, and callers
    then do not filter — hiding every location because we could not ask would
    be worse than the problem this solves.
    """
    if list_name not in _LOADERS:
        return False
    with _sync_lock, MirrorSession() as m:
        have = m.query(ProviderLocation.id).filter(ProviderLocation.provider == list_name).first() is not None
        stamp = m.get(MirrorMeta, _stamp_key(list_name))
        fresh = False
        if stamp and stamp.value:
            try:
                fresh = (datetime.now(timezone.utc) - datetime.fromisoformat(stamp.value)).days < SYNC_EVERY_DAYS
            except ValueError:
                fresh = False
        if have and fresh:
            return True
        try:
            return sync(m, list_name) > 0 or have
        except Exception as e:  # noqa: BLE001 - a failed refresh must not fail a search or a run
            m.rollback()
            log.warning("%s location list not refreshed: %s", list_name, redact(str(e)))
            return have


def backfill_saved_ids() -> int:
    """Google's ID for every saved location that has none yet, asked of
    SerpAPI once and stored — so the form's filter is a lookup by ID instead
    of a name match, and a location is asked about one time ever.

    The asking (network, seconds) happens with NO transaction open on the
    main database; the answers are then written in one short commit."""
    db = SessionLocal()
    try:
        todo = [(r.id, r.canonical_name, r.country_code, r.target_type)
                for r in db.query(SavedLocation).filter(SavedLocation.google_id.is_(None)).all()]
    finally:
        db.close()
    found = {}
    for sid, name, country, kind in todo:
        gid = serpapi_google_id({"canonical_name": name, "country_code": country, "target_type": kind})
        if gid:
            found[sid] = gid
    if not found:
        return 0
    db = SessionLocal()
    try:
        for sid, gid in found.items():
            row = db.get(SavedLocation, sid)
            if row is not None and row.google_id is None:
                row.google_id = gid
        db.commit()
    finally:
        db.close()
    return len(found)


def warm_up() -> None:
    """At startup, off the request path: the first open of the job form should
    not be the one that waits for half a million rows or sixty lookups."""
    def work() -> None:
        try:
            for list_name in _LOADERS:
                ensure_synced(list_name)
            log.info("saved locations given a Google ID: %d", backfill_saved_ids())
        except Exception as e:  # noqa: BLE001 - a convenience; never take the app down
            log.warning("location warm-up failed: %s", redact(str(e)))
    threading.Thread(target=work, name="location-warm-up", daemon=True).start()


def location_for(provider: str, ref: dict) -> tuple[Loc | None, bool]:
    """For a run: (the entry for this location in the list `provider`'s
    locations come from, whether there was a list to look in). Own sessions —
    providers have none.

    A mirror that cannot be opened or read is "no list", like one that was
    never downloaded: the query then goes out with the stored name, as it did
    before there was a mirror, instead of failing on its own lookup table."""
    list_name = LIST_OF.get(provider)
    if not list_name:
        return None, False
    try:
        if not ensure_synced(list_name):
            return None, False
        db = SessionLocal()
        try:
            return resolve(db, list_name, ref), True
        finally:
            db.close()
    except SQLAlchemyError as e:
        log.warning("%s location list unavailable, not checking the location: %s", list_name, redact(str(e))[:200])
        return None, False


def dataforseo_location(ref: dict) -> tuple[Loc | None, bool]:
    return location_for("dataforseo", ref)
