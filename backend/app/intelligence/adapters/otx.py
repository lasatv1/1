"""AlienVault OTX — subscribed pulses (official API, requires a key).

Endpoint: GET https://otx.alienvault.com/api/v1/pulses/subscribed
A pulse lists indicators and, optionally, "targeted_countries" and an "adversary".
Correlation performed here (and labelled as such):

* IPv4 indicators are geolocated (source-provided or local GeoLite2) → source country.
* Each targeted country → destination country.
* The pair is recorded with basis ``inferred``. If the pulse names an adversary, that is
  carried in the description as a third-party claim; it never changes the geography.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import httpx

from ...models import Indicator, IndicatorType, ThreatEvent
from ..correlation.countries import iso2_for_name
from ..normalizers.common import category_from_tags, country, event_id, parse_ts, public_ip
from .base import Adapter, NormalizedBatch

_TYPE_MAP: dict[str, IndicatorType] = {
    "IPv4": "ipv4",
    "IPv6": "ipv6",
    "domain": "domain",
    "hostname": "domain",
    "URL": "url",
    "FileHash-SHA256": "sha256",
    "FileHash-MD5": "md5",
    "CVE": "cve",
}
MAX_PAGES = 5


class OtxAdapter(Adapter):
    id = "alienvault-otx"
    name = "AlienVault OTX"
    url = "https://otx.alienvault.com/"
    categories = ["malware", "phishing", "ransomware", "c2", "botnet", "vulnerability"]
    attribution_method = "Pulse indicators geolocated by IP, correlated with pulse targeted-countries (inferred)"
    requires = "otx_api_key"

    async def fetch(self, client: httpx.AsyncClient) -> Any:
        since = (datetime.utcnow() - timedelta(days=self.settings.retention_days)).strftime("%Y-%m-%dT%H:%M:%S")
        url: str | None = "https://otx.alienvault.com/api/v1/pulses/subscribed"
        params: dict[str, Any] | None = {"modified_since": since, "limit": 50}
        pulses: list[dict] = []
        for _ in range(MAX_PAGES):
            if not url:
                break
            r = await client.get(url, params=params, headers={"X-OTX-API-KEY": self.secret()})
            r.raise_for_status()
            body = r.json()
            pulses.extend(body.get("results", []))
            nxt = body.get("next")
            # Only follow pagination links on the official host.
            url = nxt if isinstance(nxt, str) and nxt.startswith("https://otx.alienvault.com/") else None
            params = None
        return pulses

    def normalize(self, raw: Any, collected_at: datetime) -> NormalizedBatch:
        batch = NormalizedBatch()
        for pulse in raw or []:
            pid = pulse.get("id")
            created = parse_ts(pulse.get("created"))
            modified = parse_ts(pulse.get("modified")) or created
            if not pid or not created:
                batch.skipped += 1
                continue
            tags = list(pulse.get("tags") or []) + [m.get("display_name", "") if isinstance(m, dict) else str(m) for m in pulse.get("malware_families") or []]
            cat = category_from_tags(tags + [pulse.get("name", "")])
            targets = [c for c in (iso2_for_name(n) for n in pulse.get("targeted_countries") or []) if c]
            refs = [r for r in (pulse.get("references") or []) if isinstance(r, str) and r.startswith("https://")][:10]
            refs.append(f"https://otx.alienvault.com/pulse/{pid}")
            adversary = (pulse.get("adversary") or "").strip()
            claim = f" The pulse author attributes this activity to “{adversary}” (third-party claim, unverified)." if adversary else ""

            for ind in pulse.get("indicators") or []:
                itype = _TYPE_MAP.get(ind.get("type", ""))
                value = (ind.get("indicator") or "").strip()
                if not itype or not value:
                    continue
                ip = public_ip(value) if itype in ("ipv4", "ipv6") else None
                src = country(self.geo.country(ip)) if ip else None
                seen = parse_ts(ind.get("created")) or created
                base = dict(
                    source_id=self.id,
                    category=cat,
                    severity="medium" if cat not in ("ransomware", "c2") else "high",
                    confidence=60 if targets else 50,
                    observed_at=seen,
                    first_seen=seen,
                    last_seen=modified or seen,
                    collected_at=collected_at,
                    updated_at=modified or seen,
                    src_ip=ip,
                    indicators=[Indicator(type=itype, value=value[:2048])],
                    references=refs,
                )
                title = (pulse.get("name") or "OTX pulse")[:300]
                if src and targets:
                    for dst in targets:
                        rid = f"{pid}:{value}:{dst}"
                        batch.events.append(
                            ThreatEvent(
                                id=event_id(self.id, rid),
                                source_record_id=rid,
                                src_country=src,
                                dst_country=dst,
                                basis="inferred",
                                description=f"OTX pulse “{title}”: indicator geolocated to {src}; pulse lists {dst} as a targeted country.{claim}",
                                **base,
                            )
                        )
                elif src or (targets and not ip):
                    rid = f"{pid}:{value}"
                    batch.events.append(
                        ThreatEvent(
                            id=event_id(self.id, rid),
                            source_record_id=rid,
                            src_country=src,
                            dst_country=None if src else targets[0],
                            basis="infrastructure_geolocation" if src else "inferred",
                            description=f"OTX pulse “{title}”.{claim}",
                            **base,
                        )
                    )
                else:
                    batch.skipped += 1  # no usable geography
        return batch
