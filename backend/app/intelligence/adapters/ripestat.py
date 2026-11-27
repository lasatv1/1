"""RIPEstat Data API — per-country routing statistics (public, keyless).

Endpoint: GET https://stat.ripe.net/data/country-resource-stats/data.json?resource=<CC>
Used on demand for the Network Infrastructure layer / country profiles and cached.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

import httpx

from ...models import CountryNetworkFacts
from .base import Adapter, NormalizedBatch

_CC = re.compile(r"^[A-Z]{2}$")


class RipeStatAdapter(Adapter):
    id = "ripestat"
    name = "RIPEstat (RIPE NCC)"
    url = "https://stat.ripe.net/"
    categories = ["network"]
    attribution_method = "Routed ASNs/prefixes per country as seen by RIPE RIS collectors"

    async def fetch(self, client: httpx.AsyncClient) -> Any:  # bulk sync not used
        return None

    def normalize(self, raw: Any, collected_at: datetime) -> NormalizedBatch:
        return NormalizedBatch()

    async def country_facts(self, client: httpx.AsyncClient, cc: str) -> CountryNetworkFacts:
        if not _CC.match(cc):
            raise ValueError("invalid country code")
        r = await client.get(
            "https://stat.ripe.net/data/country-resource-stats/data.json",
            params={"resource": cc, "sourceapp": "cyberthreat-atlas"},
        )
        r.raise_for_status()
        return self.parse_country(cc, r.json())

    @staticmethod
    def parse_country(cc: str, body: dict) -> CountryNetworkFacts:
        stats = (body.get("data") or {}).get("stats") or []
        latest = stats[-1] if stats else {}
        ts = latest.get("timeline", [{}])[-1].get("starttime") if latest.get("timeline") else None
        observed = datetime.fromisoformat(ts).replace(tzinfo=UTC) if ts else datetime.now(UTC)
        return CountryNetworkFacts(
            country=cc,
            asn_count=latest.get("asns_ris"),
            ipv4_prefixes=latest.get("v4_prefixes_ris"),
            ipv6_prefixes=latest.get("v6_prefixes_ris"),
            source="RIPEstat country-resource-stats",
            observed_at=observed,
        )
