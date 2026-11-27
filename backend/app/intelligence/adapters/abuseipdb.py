"""AbuseIPDB blacklist (official API v2, requires a key).

Endpoint: GET https://api.abuseipdb.com/api/v2/blacklist
Returns highly-reported IPs with AbuseIPDB's country code and confidence score. These
are located observations of abusive sources; reporters' locations are not included in
this endpoint, so no relationship arcs are inferred.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from ...models import Indicator, ThreatEvent
from ..normalizers.common import country, event_id, parse_ts, public_ip, severity_from_score
from .base import Adapter, NormalizedBatch


class AbuseIpdbAdapter(Adapter):
    id = "abuseipdb"
    name = "AbuseIPDB"
    url = "https://www.abuseipdb.com/"
    categories = ["scanning", "botnet"]
    attribution_method = "Community abuse reports; IP country as reported by AbuseIPDB"
    requires = "abuseipdb_api_key"

    async def fetch(self, client: httpx.AsyncClient) -> Any:
        r = await client.get(
            "https://api.abuseipdb.com/api/v2/blacklist",
            params={"confidenceMinimum": 90, "limit": 5000},
            headers={"Key": self.secret(), "Accept": "application/json"},
        )
        r.raise_for_status()
        return r.json()

    def normalize(self, raw: Any, collected_at: datetime) -> NormalizedBatch:
        batch = NormalizedBatch()
        for row in (raw or {}).get("data", []):
            ip = public_ip(row.get("ipAddress"))
            seen = parse_ts(row.get("lastReportedAt"))
            if not ip or not seen:
                batch.skipped += 1
                continue
            score = int(row.get("abuseConfidenceScore") or 0)
            batch.events.append(
                ThreatEvent(
                    id=event_id(self.id, ip),
                    source_id=self.id,
                    source_record_id=ip,
                    category="scanning",
                    severity=severity_from_score(score),
                    confidence=max(0, min(100, score)),
                    observed_at=seen,
                    first_seen=seen,
                    last_seen=seen,
                    collected_at=collected_at,
                    updated_at=seen,
                    src_country=country(row.get("countryCode")) or country(self.geo.country(ip)),
                    src_ip=ip,
                    indicators=[Indicator(type="ipv6" if ":" in ip else "ipv4", value=ip)],
                    basis="infrastructure_geolocation",
                    description=f"Address reported for abuse to AbuseIPDB (confidence score {score}).",
                    references=[f"https://www.abuseipdb.com/check/{ip}"],
                )
            )
        return batch
