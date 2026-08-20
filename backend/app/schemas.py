from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


class LocationRef(BaseModel):
    canonical_name: str
    country_code: str | None = None
    name: str | None = None
    target_type: str | None = None


class JobBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
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


class JobCreate(JobBase):
    pass


class JobUpdate(BaseModel):
    name: str | None = None
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
                     "google_domains", "scrape_fields", "ahrefs_metrics", mode="before")
    @classmethod
    def _none_to_empty_list(cls, v):
        return [] if v is None else v

    @field_validator("mode", mode="before")
    @classmethod
    def _default_mode(cls, v):
        return v or "serp"


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
