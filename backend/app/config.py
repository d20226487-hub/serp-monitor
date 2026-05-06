from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    serpapi_key: str = ""
    database_url: str = "sqlite:////data/serp.db"
    serpapi_concurrency: int = 8
    max_queries_per_run: int = 2000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
