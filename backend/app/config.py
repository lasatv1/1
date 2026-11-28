"""Runtime configuration. All secrets come from environment variables (or a local
.env file that is git-ignored) and never leave the backend."""
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="CTA_", extra="ignore")

    app_name: str = "Ruster Ball API"
    version: str = "0.1.0"

    # Comma-separated list of allowed browser origins.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Rate limiting (per client IP, token bucket).
    rate_limit_per_minute: int = Field(default=240, ge=10, le=10_000)

    # Source synchronisation.
    sync_interval_minutes: int = Field(default=30, ge=5, le=24 * 60)
    http_timeout_seconds: float = Field(default=20.0, gt=0, le=120)
    retention_days: int = Field(default=365, ge=1, le=730)
    enable_keyless_sources: bool = True

    # Optional third-party credentials (server-side only).
    otx_api_key: SecretStr | None = None
    abuseipdb_api_key: SecretStr | None = None
    abusech_auth_key: SecretStr | None = None

    # Persistence. Unset = in-memory store (data lost on restart).
    # Example: postgresql://cta_app@localhost:5432/cta  (password via CTA_DATABASE_PASSWORD_FILE)
    database_url: SecretStr | None = None
    database_password_file: str | None = None
    db_pool_max: int = Field(default=10, ge=1, le=100)
    # Redis cache + message bus. Unset = no cache (everything still works).
    redis_url: SecretStr | None = None
    # Run the sync scheduler inside the API process. Set false when a separate
    # `python -m app.worker` runs (recommended for production / multiple API replicas).
    run_scheduler: bool = True

    # Natural Earth TopoJSON used to seed the PostGIS countries table (same file as the globe).
    countries_topojson: str = str(Path(__file__).resolve().parents[2] / "frontend" / "public" / "data" / "world.topo.json")

    # Optional MaxMind GeoLite2 Country database for IP → country enrichment.
    geolite2_country_db: str | None = None

    @field_validator(
        "otx_api_key", "abuseipdb_api_key", "abusech_auth_key", "database_url", "database_password_file",
        "redis_url", "geolite2_country_db", mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, v):
        # `KEY=` lines in .env mean "not configured", not "configured with an empty value".
        return None if isinstance(v, str) and not v.strip() else v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
