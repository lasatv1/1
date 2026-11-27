"""Connection settings. The password may come from a file (Docker secret) so it never
appears in environment listings or logs."""
from __future__ import annotations

from pathlib import Path

from psycopg.conninfo import make_conninfo

from ..config import Settings


def conninfo(settings: Settings) -> str:
    if settings.database_url is None:
        raise RuntimeError("CTA_DATABASE_URL is not set")
    extra: dict[str, str] = {"application_name": "cyberthreat-atlas"}
    if settings.database_password_file:
        extra["password"] = Path(settings.database_password_file).read_text(encoding="utf-8").strip()
    return make_conninfo(settings.database_url.get_secret_value(), **extra)
