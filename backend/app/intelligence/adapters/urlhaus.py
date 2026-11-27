"""abuse.ch URLhaus — recent malware distribution URLs (official API, Auth-Key required).

Endpoint: GET https://urlhaus-api.abuse.ch/v1/urls/recent/
URLhaus reports URLs and hosts but not countries. Hosts that are literal IP addresses are
geolocated with the local GeoLite2 database when configured. Hostnames are NOT resolved:
resolving attacker-controlled domains is an active interaction this platform avoids.
Entries without usable geography are counted as skipped, not placed on the map.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from ...models import Indicator, ThreatEvent
from ..normalizers.common import category_from_tags, country, event_id, parse_ts, public_ip
from .base import Adapter, NormalizedBatch


class UrlhausAdapter(Adapter):
    id = "abusech-urlhaus"
    name = "abuse.ch URLhaus"
    url = "https://urlhaus.abuse.ch/"
    categories = ["malware", "phishing", "botnet"]
    attribution_method = "Malware URL hosts; IP-literal hosts geolocated via local GeoLite2"
    requires = "abusech_auth_key"

    async def fetch(self, client: httpx.AsyncClient) -> Any:
        r = await client.get("https://urlhaus-api.abuse.ch/v1/urls/recent/", headers={"Auth-Key": self.secret()})
        r.raise_for_status()
        return r.json()

    def normalize(self, raw: Any, collected_at: datetime) -> NormalizedBatch:
        batch = NormalizedBatch()
        for row in (raw or {}).get("urls", []):
            rid = str(row.get("id") or "")
            added = parse_ts(row.get("date_added"))
            ip = public_ip(row.get("host"))
            src = country(self.geo.country(ip)) if ip else None
            if not rid or not added or not src:
                batch.skipped += 1
                continue
            tags = list(row.get("tags") or []) + [row.get("threat") or ""]
            online = row.get("url_status") == "online"
            batch.events.append(
                ThreatEvent(
                    id=event_id(self.id, rid),
                    source_id=self.id,
                    source_record_id=rid,
                    category=category_from_tags(tags, default="malware"),
                    severity="high" if online else "medium",
                    confidence=85,
                    observed_at=added,
                    first_seen=added,
                    last_seen=added,
                    collected_at=collected_at,
                    updated_at=added,
                    src_country=src,
                    src_ip=ip,
                    indicators=[Indicator(type="url", value=(row.get("url") or "")[:2048]), Indicator(type="ipv4", value=ip)],
                    basis="infrastructure_geolocation",
                    description=f"Malware distribution URL reported to URLhaus ({row.get('threat') or 'unspecified'}, {'online' if online else 'offline'}).",
                    references=[r for r in [row.get("urlhaus_reference")] if isinstance(r, str) and r.startswith("https://urlhaus.abuse.ch/")],
                )
            )
        return batch
