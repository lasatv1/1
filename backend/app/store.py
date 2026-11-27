"""Observation store.

The initial implementation keeps observations in memory behind a small repository
interface so the API, scheduler and tests do not depend on the storage engine.
`db/schema.sql` defines the PostgreSQL/PostGIS schema a persistent repository will
implement; swapping it in only requires another class with the same methods.

Provenance: records are keyed by (source_id, source_record_id). Re-ingesting a record
updates last_seen/updated_at but keeps the original id, first_seen and collected_at, so
history is preserved rather than overwritten.
"""
from __future__ import annotations

import asyncio
import threading
from bisect import bisect_left, bisect_right
from datetime import UTC, datetime, timedelta

from .intelligence.aggregation.relationships import aggregate
from .models import CatalogEntry, CountryNetworkFacts, IntelSource, RelationshipAggregate, ThreatEvent


class MemoryStore:
    name = "memory"

    def __init__(self, retention_days: int = 30) -> None:
        self._lock = threading.RLock()
        self._events: dict[tuple[str, str], ThreatEvent] = {}
        self._sorted: list[ThreatEvent] | None = None
        self._sources: dict[str, IntelSource] = {}
        self._network: dict[str, CountryNetworkFacts] = {}
        self._catalog: dict[str, list[CatalogEntry]] = {}
        self._retention = timedelta(days=retention_days)
        self.listeners: set[asyncio.Queue[dict]] = set()

    # -- sources -------------------------------------------------------------
    def upsert_source(self, source: IntelSource) -> None:
        with self._lock:
            self._sources[source.id] = source

    def get_source(self, source_id: str) -> IntelSource | None:
        with self._lock:
            return self._sources.get(source_id)

    def sources(self) -> list[IntelSource]:
        with self._lock:
            counts: dict[str, int] = {}
            for sid, _ in self._events:
                counts[sid] = counts.get(sid, 0) + 1
            return [
                s.model_copy(update={"record_count": counts.get(s.id, 0) + len(self._catalog.get(s.id, []))})
                for s in self._sources.values()
            ]

    # -- events --------------------------------------------------------------
    def upsert_events(self, events: list[ThreatEvent]) -> int:
        """Inserts or refreshes events; returns the number of previously unseen records."""
        new = 0
        with self._lock:
            for e in events:
                key = (e.source_id, e.source_record_id)
                prev = self._events.get(key)
                if prev is None:
                    new += 1
                    self._events[key] = e
                else:
                    self._events[key] = e.model_copy(
                        update={
                            "id": prev.id,
                            "first_seen": min(prev.first_seen, e.first_seen),
                            "collected_at": prev.collected_at,
                        }
                    )
            self._sorted = None
            self._prune()
        return new

    def _prune(self) -> None:
        cutoff = datetime.now(UTC) - self._retention
        for k in [k for k, e in self._events.items() if e.observed_at < cutoff]:
            del self._events[k]

    def _ordered(self) -> list[ThreatEvent]:
        if self._sorted is None:
            self._sorted = sorted(self._events.values(), key=lambda e: (e.observed_at, e.id))
        return self._sorted

    def events(self, start: datetime, end: datetime, offset: int, limit: int) -> tuple[list[ThreatEvent], int]:
        with self._lock:
            ordered = self._ordered()
            keys = [e.observed_at for e in ordered]
            window = ordered[bisect_left(keys, start) : bisect_right(keys, end)]
            return window[offset : offset + limit], len(window)

    def relationships(self, start: datetime, end: datetime, limit: int) -> list[RelationshipAggregate]:
        items, _ = self.events(start, end, 0, 10_000_000)
        return aggregate(items)[:limit]

    def country_at(self, lng: float, lat: float) -> dict | None:
        return None  # geographic queries need PostGIS

    def close(self) -> None:
        pass

    def ping(self) -> bool:
        return True

    def all_events(self) -> list[ThreatEvent]:
        with self._lock:
            return list(self._ordered())

    # -- network facts / catalogues ----------------------------------------
    def set_network(self, facts: CountryNetworkFacts) -> None:
        with self._lock:
            self._network[facts.country] = facts

    def get_network(self, country: str) -> CountryNetworkFacts | None:
        with self._lock:
            return self._network.get(country)

    def all_network(self) -> dict[str, CountryNetworkFacts]:
        with self._lock:
            return dict(self._network)

    def set_catalog(self, source_id: str, entries: list[CatalogEntry]) -> None:
        with self._lock:
            self._catalog[source_id] = entries

    def catalog(self, source_id: str) -> list[CatalogEntry]:
        with self._lock:
            return list(self._catalog.get(source_id, []))

    # -- notifications -------------------------------------------------------
    def publish(self, message: dict) -> None:
        for q in list(self.listeners):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass
