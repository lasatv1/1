"""Optional IP → country/ASN enrichment using a local MaxMind GeoLite2 database.

Lookups are fully offline (no network calls). Without a configured database the
enricher is a no-op and records keep only the geolocation their source provided.
GeoLite2 is © MaxMind and requires accepting their licence; the database file is not
distributed with this project.
"""
from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger("cta.enrichment")


class GeoEnricher:
    def __init__(self, db_path: str | None) -> None:
        self._reader = None
        self.source = None
        if not db_path:
            return
        path = Path(db_path)
        if not path.is_file():
            log.warning("GeoLite2 database not found at configured path; enrichment disabled")
            return
        try:
            import geoip2.database  # noqa: PLC0415

            self._reader = geoip2.database.Reader(str(path))
            self.source = f"MaxMind GeoLite2 ({self._reader.metadata().database_type})"
        except Exception as exc:  # pragma: no cover - depends on local file
            log.warning("GeoLite2 could not be opened: %s", type(exc).__name__)

    @property
    def available(self) -> bool:
        return self._reader is not None

    def country(self, ip: str | None) -> str | None:
        if not self._reader or not ip:
            return None
        try:
            return self._reader.country(ip).country.iso_code
        except Exception:
            return None
