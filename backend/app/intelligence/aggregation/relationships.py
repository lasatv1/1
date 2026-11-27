"""Server-side aggregation of observations into directed country relationships, so
clients can request summaries instead of raw events for large windows."""
from __future__ import annotations

from collections.abc import Iterable

from ...models import RelationshipAggregate, ThreatEvent

_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}


def aggregate(events: Iterable[ThreatEvent]) -> list[RelationshipAggregate]:
    groups: dict[tuple[str, str, str], dict] = {}
    for e in events:
        if not e.src_country or not e.dst_country or e.src_country == e.dst_country:
            continue
        key = (e.src_country, e.dst_country, e.category)
        g = groups.get(key)
        if g is None:
            g = groups[key] = {"severity": e.severity, "count": 0, "first": e.observed_at, "last": e.observed_at, "sources": set(), "bases": set()}
        g["count"] += 1
        g["sources"].add(e.source_id)
        g["bases"].add(e.basis)
        if _RANK[e.severity] > _RANK[g["severity"]]:
            g["severity"] = e.severity
        g["first"] = min(g["first"], e.observed_at)
        g["last"] = max(g["last"], e.observed_at)
    out = [
        RelationshipAggregate(
            src=s, dst=d, category=c, severity=g["severity"], count=g["count"],
            first_seen=g["first"], last_seen=g["last"], sources=sorted(g["sources"]), bases=sorted(g["bases"]),
        )
        for (s, d, c), g in groups.items()
    ]
    out.sort(key=lambda r: r.count, reverse=True)
    return out
