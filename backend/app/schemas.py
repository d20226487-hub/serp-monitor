from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


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


class JobOut(JobBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


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
