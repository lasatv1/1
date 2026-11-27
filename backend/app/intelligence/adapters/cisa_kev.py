"""CISA Known Exploited Vulnerabilities catalog (official JSON feed).

Feed: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
The catalog is not geographic, so it is stored as a catalogue (listed in the UI) and is
deliberately *not* turned into map observations.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from ...models import CatalogEntry
from ..normalizers.common import parse_ts
from .base import Adapter, NormalizedBatch


class CisaKevAdapter(Adapter):
    id = "cisa-kev"
    name = "CISA KEV catalog"
    url = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"
    feed = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
    categories = ["vulnerability"]
    attribution_method = "Catalogue of exploited CVEs; not geolocated, listed only"

    async def fetch(self, client: httpx.AsyncClient) -> Any:
        r = await client.get(self.feed)
        r.raise_for_status()
        return r.json()

    def normalize(self, raw: Any, collected_at: datetime) -> NormalizedBatch:
        batch = NormalizedBatch(catalog=[])
        for v in (raw or {}).get("vulnerabilities", []):
            cve = v.get("cveID")
            if not cve:
                batch.skipped += 1
                continue
            batch.catalog.append(  # type: ignore[union-attr]
                CatalogEntry(
                    id=cve,
                    title=v.get("vulnerabilityName") or cve,
                    vendor=v.get("vendorProject"),
                    product=v.get("product"),
                    date_added=parse_ts(v.get("dateAdded")),
                    due_date=parse_ts(v.get("dueDate")),
                    known_ransomware_use=(v.get("knownRansomwareCampaignUse") == "Known"),
                    reference=f"https://nvd.nist.gov/vuln/detail/{cve}",
                )
            )
        batch.catalog.sort(key=lambda e: e.date_added or collected_at, reverse=True)  # type: ignore[union-attr]
        batch.detail = f"Catalog version {raw.get('catalogVersion', '?')}" if isinstance(raw, dict) else None
        return batch
