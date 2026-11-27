"""abuse.ch Feodo Tracker — botnet C2 server blocklist (published JSON feed).

Feed: https://feodotracker.abuse.ch/downloads/ipblocklist.json
Each entry is a C2 server IP with the country/ASN abuse.ch reports for it. These are
*located infrastructure* observations: there is no victim/destination country, so they
render as markers, never as arcs.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from ...models import Indicator, ThreatEvent
from ..normalizers.common import country, event_id, parse_ts, public_ip
from .base import Adapter, NormalizedBatch


class FeodoAdapter(Adapter):
    id = "abusech-feodo"
    name = "abuse.ch Feodo Tracker"
    url = "https://feodotracker.abuse.ch/"
    feed = "https://feodotracker.abuse.ch/downloads/ipblocklist.json"
    categories = ["c2", "botnet"]
    attribution_method = "C2 server IP with country/ASN as published by abuse.ch (infrastructure geolocation)"

    async def fetch(self, client: httpx.AsyncClient) -> Any:
        headers = {}
        if self.settings.abusech_auth_key:
            headers["Auth-Key"] = self.settings.abusech_auth_key.get_secret_value()
        r = await client.get(self.feed, headers=headers)
        r.raise_for_status()
        return r.json()

    def normalize(self, raw: Any, collected_at: datetime) -> NormalizedBatch:
        batch = NormalizedBatch()
        if not isinstance(raw, list):
            batch.detail = "Unexpected feed format"
            return batch
        for row in raw:
            ip = public_ip(row.get("ip_address"))
            first = parse_ts(row.get("first_seen"))
            last = parse_ts(row.get("last_online")) or first
            if not ip or not first:
                batch.skipped += 1
                continue
            online = (row.get("status") or "").lower() == "online"
            malware = (row.get("malware") or "unknown").strip()
            record_id = f"{ip}:{row.get('port', '')}"
            asn = row.get("as_number")
            batch.events.append(
                ThreatEvent(
                    id=event_id(self.id, record_id),
                    source_id=self.id,
                    source_record_id=record_id,
                    category="c2",
                    severity="high" if online else "medium",
                    confidence=90,
                    observed_at=last,
                    first_seen=first,
                    last_seen=last,
                    collected_at=collected_at,
                    updated_at=last,
                    src_country=country(row.get("country")) or country(self.geo.country(ip)),
                    src_ip=ip,
                    src_asn=int(asn) if str(asn or "").isdigit() else None,
                    src_org=(row.get("as_name") or None),
                    indicators=[Indicator(type="ipv4" if ":" not in ip else "ipv6", value=ip)],
                    basis="infrastructure_geolocation",
                    description=(
                        f"{malware} command-and-control server reported by abuse.ch Feodo Tracker "
                        f"({'online' if online else 'offline'} at last check, port {row.get('port', '?')})."
                    ),
                    references=[f"https://feodotracker.abuse.ch/browse/host/{ip}/"],
                )
            )
        return batch
