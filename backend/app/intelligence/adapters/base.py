"""Adapter contract. Each intelligence source gets one adapter that:

1. fetches raw data from the source's official API or published feed (``fetch``), and
2. converts it into normalised, provenance-carrying records (``normalize``).

Keeping ``normalize`` pure (raw → records) makes adapters testable without network
access. Adapters never scrape web pages, never perform active scanning, and only read
credentials from server-side settings.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from ...config import Settings
from ...models import CatalogEntry, Category, CountryNetworkFacts, ThreatEvent
from ..enrichment.geoip import GeoEnricher


@dataclass
class NormalizedBatch:
    events: list[ThreatEvent] = field(default_factory=list)
    catalog: list[CatalogEntry] | None = None
    network: list[CountryNetworkFacts] = field(default_factory=list)
    skipped: int = 0
    detail: str | None = None


class Adapter(ABC):
    id: str
    name: str
    url: str
    categories: list[Category]
    attribution_method: str
    requires: str | None = None  # name of the credential setting, if any

    def __init__(self, settings: Settings, geo: GeoEnricher) -> None:
        self.settings = settings
        self.geo = geo

    def configured(self) -> bool:
        if self.requires:
            return getattr(self.settings, self.requires) is not None
        return self.settings.enable_keyless_sources

    def not_configured_reason(self) -> str:
        if self.requires:
            return f"Set CTA_{self.requires.upper()} on the backend to enable"
        return "Keyless sources disabled (CTA_ENABLE_KEYLESS_SOURCES=false)"

    def secret(self) -> str:
        value = getattr(self.settings, self.requires) if self.requires else None
        return value.get_secret_value() if value is not None else ""

    @abstractmethod
    async def fetch(self, client: httpx.AsyncClient) -> Any: ...

    @abstractmethod
    def normalize(self, raw: Any, collected_at: datetime) -> NormalizedBatch: ...
