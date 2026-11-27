"""PostgreSQL/PostGIS repository. Same interface as MemoryStore (app/store.py).

Methods are synchronous and are called from the API/scheduler via asyncio.to_thread,
so database I/O never blocks the event loop. All SQL is parameterised.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, UTC

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from ..models import CatalogEntry, CountryNetworkFacts, IntelSource, RelationshipAggregate, ThreatEvent

log = logging.getLogger("cta.db")

_EVENT_COLS = """
    e.public_id, e.source_id, e.source_record_id, e.category, e.severity, e.confidence, e.basis,
    e.src_country, e.dst_country, host(e.src_ip) AS src_ip, host(e.dst_ip) AS dst_ip, e.src_asn, e.dst_asn, e.src_org,
    e.first_seen, e.last_seen, e.observed_at, e.collected_at, e.updated_at, e.description, e.refs,
    COALESCE((SELECT json_agg(json_build_object('type', i.type, 'value', i.value) ORDER BY i.type, i.value)
              FROM event_indicators ei JOIN indicators i ON i.id = ei.indicator_id
              WHERE ei.event_id = e.id), '[]'::json) AS indicators
"""


def _event(r: dict) -> ThreatEvent:
    return ThreatEvent(
        id=r["public_id"],
        source_id=r["source_id"],
        source_record_id=r["source_record_id"],
        category=r["category"],
        severity=r["severity"],
        confidence=r["confidence"],
        basis=r["basis"],
        src_country=r["src_country"],
        dst_country=r["dst_country"],
        src_ip=r["src_ip"],
        dst_ip=r["dst_ip"],
        src_asn=r["src_asn"],
        dst_asn=r["dst_asn"],
        src_org=r["src_org"],
        first_seen=r["first_seen"],
        last_seen=r["last_seen"],
        observed_at=r["observed_at"],
        collected_at=r["collected_at"],
        updated_at=r["updated_at"],
        description=r["description"],
        references=r["refs"] or [],
        indicators=r["indicators"] or [],
    )


class PostgresStore:
    name = "postgres"

    def __init__(self, pool: ConnectionPool, retention_days: int = 365) -> None:
        self.pool = pool
        self._retention = timedelta(days=retention_days)
        # SSE subscribers are per API process (in-memory fan-out).
        self.listeners: set[asyncio.Queue[dict]] = set()

    def close(self) -> None:
        self.pool.close()

    def ping(self) -> bool:
        try:
            with self.pool.connection(timeout=2) as conn:
                conn.execute("SELECT 1")
            return True
        except Exception:
            return False

    # -- sources -------------------------------------------------------------
    def upsert_source(self, s: IntelSource) -> None:
        with self.pool.connection() as conn:
            conn.execute(
                """
                INSERT INTO intelligence_sources (id, name, source_url, status, status_detail, last_sync, attribution_method, categories, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, source_url = EXCLUDED.source_url, status = EXCLUDED.status,
                    status_detail = EXCLUDED.status_detail,
                    last_sync = COALESCE(EXCLUDED.last_sync, intelligence_sources.last_sync),
                    attribution_method = EXCLUDED.attribution_method, categories = EXCLUDED.categories, updated_at = now()
                """,
                (s.id, s.name, s.url, s.status, s.status_detail, s.last_sync, s.attribution_method, list(s.categories)),
            )

    def get_source(self, source_id: str) -> IntelSource | None:
        rows = self._sources("WHERE s.id = %s", (source_id,))
        return rows[0] if rows else None

    def sources(self) -> list[IntelSource]:
        return self._sources("", ())

    def _sources(self, where: str, params: tuple) -> list[IntelSource]:
        with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                f"""
                SELECT s.*,
                  (SELECT count(*) FROM threat_events e WHERE e.source_id = s.id)
                + (SELECT count(*) FROM catalog_entries c WHERE c.source_id = s.id) AS record_count
                FROM intelligence_sources s {where} ORDER BY s.id
                """,
                params,
            )
            return [
                IntelSource(
                    id=r["id"], name=r["name"], url=r["source_url"], status=r["status"], status_detail=r["status_detail"],
                    last_sync=r["last_sync"], record_count=r["record_count"], attribution_method=r["attribution_method"],
                    categories=r["categories"],
                )
                for r in cur.fetchall()
            ]

    # -- events --------------------------------------------------------------
    def upsert_events(self, events: list[ThreatEvent]) -> int:
        """Upserts events and their indicators. Returns the number of new records.

        On conflict the original public id, first_seen and collected_at are kept. A new
        threat_event_versions row is written only when the record's content changed, so
        history is preserved without growing on every unchanged re-sync."""
        if not events:
            self._prune()
            return 0
        new = 0
        with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO threat_events (public_id, source_id, source_record_id, category, severity, confidence, basis,
                    src_country, dst_country, src_ip, dst_ip, src_asn, dst_asn, src_org,
                    first_seen, last_seen, observed_at, collected_at, updated_at, description, refs)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (source_id, source_record_id) DO UPDATE SET
                    category = EXCLUDED.category, severity = EXCLUDED.severity, confidence = EXCLUDED.confidence,
                    basis = EXCLUDED.basis, src_country = EXCLUDED.src_country, dst_country = EXCLUDED.dst_country,
                    src_ip = EXCLUDED.src_ip, dst_ip = EXCLUDED.dst_ip, src_asn = EXCLUDED.src_asn, dst_asn = EXCLUDED.dst_asn,
                    src_org = EXCLUDED.src_org,
                    first_seen = LEAST(threat_events.first_seen, EXCLUDED.first_seen),
                    last_seen = GREATEST(threat_events.last_seen, EXCLUDED.last_seen),
                    observed_at = EXCLUDED.observed_at, updated_at = EXCLUDED.updated_at,
                    description = EXCLUDED.description, refs = EXCLUDED.refs
                RETURNING id, (xmax = 0) AS inserted
                """,
                [
                    (e.id, e.source_id, e.source_record_id, e.category, e.severity, e.confidence, e.basis,
                     e.src_country, e.dst_country, e.src_ip, e.dst_ip, e.src_asn, e.dst_asn, e.src_org,
                     e.first_seen, e.last_seen, e.observed_at, e.collected_at, e.updated_at, e.description,
                     Jsonb(e.references))
                    for e in events
                ],
                returning=True,
            )
            ids: list[int] = []
            while True:
                row = cur.fetchone()
                if row:
                    ids.append(row[0])
                    new += 1 if row[1] else 0
                if not cur.nextset():
                    break

            # History: record a version only when the source's content actually changed.
            # (collectedAt differs on every sync, so it is excluded from the comparison;
            # without this, every unchanged record would add a row per sync.)
            cur.executemany(
                """
                INSERT INTO threat_event_versions (event_id, collected_at, payload)
                SELECT %(id)s, %(ts)s, %(p)s
                WHERE %(p)s IS DISTINCT FROM (
                    SELECT v.payload FROM threat_event_versions v
                    WHERE v.event_id = %(id)s ORDER BY v.collected_at DESC LIMIT 1)
                ON CONFLICT DO NOTHING
                """,
                [
                    {"id": i, "ts": e.collected_at,
                     "p": Jsonb(json.loads(e.model_dump_json(exclude={"collected_at"})))}
                    for i, e in zip(ids, events, strict=True)
                ],
            )

            # Indicators: upsert unique (type, value), then link.
            uniq: dict[tuple[str, str], tuple[datetime, datetime]] = {}
            for e in events:
                for ind in e.indicators:
                    k = (ind.type, ind.value)
                    lo, hi = uniq.get(k, (e.first_seen, e.last_seen))
                    uniq[k] = (min(lo, e.first_seen), max(hi, e.last_seen))
            ind_id: dict[tuple[str, str], int] = {}
            if uniq:
                keys = list(uniq)
                cur.executemany(
                    """
                    INSERT INTO indicators (type, value, first_seen, last_seen) VALUES (%s, %s, %s, %s)
                    ON CONFLICT (type, value) DO UPDATE SET first_seen = LEAST(indicators.first_seen, EXCLUDED.first_seen),
                        last_seen = GREATEST(indicators.last_seen, EXCLUDED.last_seen)
                    RETURNING id
                    """,
                    [(k[0], k[1], *uniq[k]) for k in keys],
                    returning=True,
                )
                n = 0
                while True:
                    row = cur.fetchone()
                    if row:
                        ind_id[keys[n]] = row[0]
                        n += 1
                    if not cur.nextset():
                        break
                links = {(eid, ind_id[(i.type, i.value)]) for eid, e in zip(ids, events, strict=True) for i in e.indicators}
                cur.executemany("INSERT INTO event_indicators (event_id, indicator_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", list(links))

            # Network entities observed in this batch.
            ents = {(e.src_ip, e.source_id): e for e in events if e.src_ip}
            if ents:
                cur.executemany(
                    """
                    INSERT INTO network_entities (ip_address, source_id, asn, country_code, organization, first_seen, last_seen)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (ip_address, source_id) DO UPDATE SET asn = EXCLUDED.asn, country_code = EXCLUDED.country_code,
                        organization = EXCLUDED.organization, first_seen = LEAST(network_entities.first_seen, EXCLUDED.first_seen),
                        last_seen = GREATEST(network_entities.last_seen, EXCLUDED.last_seen)
                    """,
                    [(ip, sid, e.src_asn, e.src_country, e.src_org, e.first_seen, e.last_seen) for (ip, sid), e in ents.items()],
                )
        self._prune()
        self.refresh_relationships()
        return new

    def _prune(self) -> None:
        with self.pool.connection() as conn:
            conn.execute("DELETE FROM threat_events WHERE observed_at < %s", (datetime.now(UTC) - self._retention,))

    def refresh_relationships(self) -> None:
        with self.pool.connection() as conn, conn.transaction():
            conn.execute("DELETE FROM country_relationships")
            conn.execute(
                """
                INSERT INTO country_relationships (source_country, destination_country, category, bases, event_count, first_seen, last_seen)
                SELECT src_country, dst_country, category, array_agg(DISTINCT basis ORDER BY basis), count(*), min(observed_at), max(observed_at)
                FROM threat_events
                WHERE src_country IS NOT NULL AND dst_country IS NOT NULL AND src_country <> dst_country
                GROUP BY 1, 2, 3
                """
            )

    def events(self, start: datetime, end: datetime, offset: int, limit: int) -> tuple[list[ThreatEvent], int]:
        with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT count(*) AS n FROM threat_events WHERE observed_at BETWEEN %s AND %s", (start, end))
            total = cur.fetchone()["n"]  # type: ignore[index]
            cur.execute(
                f"SELECT {_EVENT_COLS} FROM threat_events e WHERE e.observed_at BETWEEN %s AND %s "
                "ORDER BY e.observed_at, e.public_id OFFSET %s LIMIT %s",
                (start, end, offset, limit),
            )
            return [_event(r) for r in cur.fetchall()], total

    def all_events(self) -> list[ThreatEvent]:
        with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(f"SELECT {_EVENT_COLS} FROM threat_events e ORDER BY e.observed_at, e.public_id")
            return [_event(r) for r in cur.fetchall()]

    def relationships(self, start: datetime, end: datetime, limit: int) -> list[RelationshipAggregate]:
        """Server-side aggregation in SQL (severity = highest observed)."""
        with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT src_country AS src, dst_country AS dst, category,
                       (ARRAY['info','low','medium','high','critical'])[max(CASE severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4
                            WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END)] AS severity,
                       count(*) AS count, min(observed_at) AS first_seen, max(observed_at) AS last_seen,
                       array_agg(DISTINCT source_id ORDER BY source_id) AS sources, array_agg(DISTINCT basis ORDER BY basis) AS bases
                FROM threat_events
                WHERE observed_at BETWEEN %s AND %s AND src_country IS NOT NULL AND dst_country IS NOT NULL AND src_country <> dst_country
                GROUP BY 1, 2, 3 ORDER BY count(*) DESC LIMIT %s
                """,
                (start, end, limit),
            )
            return [RelationshipAggregate(**r) for r in cur.fetchall()]

    # -- geography (PostGIS) -------------------------------------------------
    def country_at(self, lng: float, lat: float) -> dict | None:
        with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, iso2, iso3, name, region, subregion FROM countries
                WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                ORDER BY ST_Area(geom) ASC LIMIT 1
                """,
                (lng, lat),
            )
            return cur.fetchone()

    def countries_count(self) -> int:
        with self.pool.connection() as conn:
            return conn.execute("SELECT count(*) FROM countries").fetchone()[0]  # type: ignore[index]

    # -- network facts / catalogues ----------------------------------------
    def set_network(self, f: CountryNetworkFacts) -> None:
        with self.pool.connection() as conn:
            conn.execute(
                """
                INSERT INTO country_network_stats (country, asn_count, ipv4_prefixes, ipv6_prefixes, source, observed_at, fetched_at)
                VALUES (%s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (country) DO UPDATE SET asn_count = EXCLUDED.asn_count, ipv4_prefixes = EXCLUDED.ipv4_prefixes,
                    ipv6_prefixes = EXCLUDED.ipv6_prefixes, source = EXCLUDED.source, observed_at = EXCLUDED.observed_at, fetched_at = now()
                """,
                (f.country, f.asn_count, f.ipv4_prefixes, f.ipv6_prefixes, f.source, f.observed_at),
            )

    def _network_rows(self, where: str, params: tuple) -> list[CountryNetworkFacts]:
        with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(f"SELECT * FROM country_network_stats {where}", params)
            return [
                CountryNetworkFacts(country=r["country"], asn_count=r["asn_count"], ipv4_prefixes=r["ipv4_prefixes"],
                                    ipv6_prefixes=r["ipv6_prefixes"], source=r["source"], observed_at=r["observed_at"])
                for r in cur.fetchall()
            ]

    def get_network(self, country: str) -> CountryNetworkFacts | None:
        rows = self._network_rows("WHERE country = %s", (country,))
        return rows[0] if rows else None

    def all_network(self) -> dict[str, CountryNetworkFacts]:
        return {f.country: f for f in self._network_rows("", ())}

    def set_catalog(self, source_id: str, entries: list[CatalogEntry]) -> None:
        with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("DELETE FROM catalog_entries WHERE source_id = %s", (source_id,))
            cur.executemany(
                """INSERT INTO catalog_entries (source_id, entry_id, title, vendor, product, date_added, due_date, known_ransomware_use, reference)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                [(source_id, c.id, c.title, c.vendor, c.product, c.date_added, c.due_date, c.known_ransomware_use, c.reference) for c in entries],
            )

    def catalog(self, source_id: str) -> list[CatalogEntry]:
        with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT * FROM catalog_entries WHERE source_id = %s ORDER BY date_added DESC NULLS LAST, entry_id", (source_id,)
            )
            return [
                CatalogEntry(id=r["entry_id"], title=r["title"], vendor=r["vendor"], product=r["product"], date_added=r["date_added"],
                             due_date=r["due_date"], known_ransomware_use=r["known_ransomware_use"], reference=r["reference"])
                for r in cur.fetchall()
            ]

    # -- notifications -------------------------------------------------------
    def publish(self, message: dict) -> None:
        for q in list(self.listeners):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass
