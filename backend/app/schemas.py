from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


class LocationRef(BaseModel):
    canonical_name: str
    country_code: str | None = None
    name: str | None = None
    target_type: str | None = None


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # Accepted as pasted; the router normalises to bare hosts before storing.
    domains: list[str] = Field(default_factory=list)
    notes: str | None = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    domains: list[str] | None = None
    notes: str | None = None


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime
    # What the project's jobs add up to. All computed per response rather than
    # stored: the jobs decide every one of these, and a stored copy would drift
    # the moment one changed.
    job_count: int = 0
    keyword_count: int = 0
    geos: list[str] = Field(default_factory=list)
    engines: list[str] = Field(default_factory=list)

    @field_validator("domains", mode="before")
    @classmethod
    def _none_to_empty_list(cls, v):
        return [] if v is None else v


class JobBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # Which project folder the job belongs to. None = ungrouped.
    project_id: int | None = None
    keywords: list[str] = Field(default_factory=list)
    engines: list[str] = Field(default_factory=list)
    devices: list[str] = Field(default_factory=list)
    locations: list[LocationRef] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    google_domains: list[str] = Field(default_factory=list)
    scrape_fields: list[str] = Field(default_factory=lambda: ["url", "title", "description"])
    top_n: int = 10
    cron: str | None = None
    schedule_enabled: bool = False
    provider: str = "serpapi"
    mode: str = "serp"  # "serp" | "analyzer"
    ahrefs_metrics: list[str] = Field(default_factory=list)
    ahrefs_domain_metrics: list[str] = Field(default_factory=list)
    whois_enabled: bool = False
    # Report the host the engine displayed (AMP/CDN publisher) instead of the
    # delivery host. Raw values stay stored either way.
    prefer_shown_host: bool = False


class JobCreate(JobBase):
    pass


class JobUpdate(BaseModel):
    name: str | None = None
    project_id: int | None = None
    keywords: list[str] | None = None
    engines: list[str] | None = None
    devices: list[str] | None = None
    locations: list[LocationRef] | None = None
    languages: list[str] | None = None
    google_domains: list[str] | None = None
    scrape_fields: list[str] | None = None
    top_n: int | None = None
    cron: str | None = None
    schedule_enabled: bool | None = None
    provider: str | None = None
    mode: str | None = None
    ahrefs_metrics: list[str] | None = None
    ahrefs_domain_metrics: list[str] | None = None
    whois_enabled: bool | None = None
    prefer_shown_host: bool | None = None


class JobOut(JobBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime

    # Rows written before a JSON list column existed come back NULL, which would
    # otherwise fail validation and 500 the whole endpoint (one legacy row breaks
    # the entire list response). Coerce to the empty list instead — a missing
    # value here genuinely means "nothing selected".
    @field_validator("keywords", "engines", "devices", "locations", "languages",
                     "google_domains", "scrape_fields", "ahrefs_metrics",
                     "ahrefs_domain_metrics", mode="before")
    @classmethod
    def _none_to_empty_list(cls, v):
        return [] if v is None else v

    @field_validator("mode", mode="before")
    @classmethod
    def _default_mode(cls, v):
        return v or "serp"

    @field_validator("whois_enabled", "prefer_shown_host", mode="before")
    @classmethod
    def _none_to_false(cls, v):
        return False if v is None else v


class JobRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_id: int
    status: str
    started_at: datetime
    finished_at: datetime | None
    queries_total: int
    queries_done: int
    queries_failed: int
    error: str | None
    triggered_by: str
    cost: float | None = None
    cost_source: str | None = None  # "actual" | "estimate" | None (pre-tracking)
    # scrape | ahrefs | whois | ai — the phase most recently entered. NULL on
    # runs that predate phase tracking.
    phase: str | None = None


class JobPage(BaseModel):
    """One page of the jobs list.

    An envelope rather than a bare list because the page needs the total to
    draw pagination, and counting client-side is exactly what pagination exists
    to avoid.
    """
    items: list[JobOut]
    total: int
    limit: int
    offset: int


class ResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    keyword: str
    engine: str
    device: str
    location: str | None
    country_code: str | None
    language: str | None
    google_domain: str | None
    position: int
    url: str | None
    title: str | None
    description: str | None
    domain: str | None


class CostEstimate(BaseModel):
    total_queries: int
    by_engine: dict[str, int]


class SavedLocationCreate(BaseModel):
    canonical_name: str = Field(min_length=1, max_length=300)
    name: str | None = None
    country_code: str | None = Field(default=None, max_length=8)
    target_type: str | None = None
    yandex_lr: int | None = None
    notes: str | None = None


class SavedLocationOut(SavedLocationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class BulkLocationsImport(BaseModel):
    items: list[SavedLocationCreate]
