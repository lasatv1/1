"""PostgreSQL/PostGIS integration tests.

Run against a disposable database (all tables are dropped and recreated):
    CTA_TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5433/cta_test pytest tests/test_postgres.py
Skipped when the variable is not set.
"""
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest

URL = os.environ.get("CTA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="CTA_TEST_DATABASE_URL not set")

TOPO = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data" / "world.topo.json"


@pytest.fixture(scope="module")
def store():
    import psycopg
    from psycopg_pool import ConnectionPool

    from app.db.migrate import migrate
    from app.db.postgres_store import PostgresStore
    from app.db.seed_countries import seed_countries

    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("DROP SCHEMA IF EXISTS cta_test CASCADE")
        c.execute("CREATE SCHEMA cta_test")
    pool = ConnectionPool(URL, kwargs={"options": "-c search_path=cta_test,public"}, open=True)
    with pool.connection() as conn:
        assert migrate(conn) == ["001_init"]
        assert migrate(conn) == []  # idempotent
        seed_countries(conn, TOPO)
    s = PostgresStore(pool, retention_days=3650)
    yield s
    s.close()


def _feodo(last_online: str):
    from app.config import Settings
    from app.intelligence.adapters.feodo import FeodoAdapter
    from app.intelligence.enrichment.geoip import GeoEnricher

    raw = [{"ip_address": "8.8.4.4", "port": 443, "status": "online", "country": "US", "as_number": 15169,
            "first_seen": "2026-11-01 08:00:00", "last_online": last_online, "malware": "QakBot"}]
    return FeodoAdapter(Settings(), GeoEnricher(None))


def test_upsert_dedupes_and_keeps_history(store):
    from app.scheduler import source_record

    a = _feodo("2026-11-20")
    store.upsert_source(source_record(a, status="ok"))
    t1 = datetime(2026, 11, 26, 12, tzinfo=UTC)
    raw = [{"ip_address": "8.8.4.4", "port": 443, "status": "online", "country": "US", "as_number": 15169,
            "first_seen": "2026-11-01 08:00:00", "last_online": "2026-11-20", "malware": "QakBot"}]
    assert store.upsert_events(a.normalize(raw, t1).events) == 1
    raw[0]["last_online"] = "2026-11-25"
    t2 = datetime(2026, 11, 26, 13, tzinfo=UTC)
    assert store.upsert_events(a.normalize(raw, t2).events) == 0
    (e,) = store.all_events()
    assert e.collected_at == t1 and e.last_seen.day == 25
    assert [i.value for i in e.indicators] == ["8.8.4.4"]
    with store.pool.connection() as c:
        assert c.execute("SELECT count(*) FROM threat_event_versions").fetchone()[0] == 2  # content changed
    # An identical re-sync must not grow history (it would otherwise add a row per sync).
    t3 = datetime(2026, 11, 26, 14, tzinfo=UTC)
    assert store.upsert_events(a.normalize(raw, t3).events) == 0
    with store.pool.connection() as c:
        assert c.execute("SELECT count(*) FROM threat_event_versions").fetchone()[0] == 2
    items, total = store.events(datetime(2026, 1, 1, tzinfo=UTC), datetime(2027, 1, 1, tzinfo=UTC), 0, 10)
    assert total == 1 and items[0].src_ip == "8.8.4.4"
    assert store.get_source(a.id).record_count == 1


def test_postgis_country_lookup(store):
    assert store.country_at(2.35, 48.85)["iso2"] == "FR"
    assert store.country_at(-30, 30) is None
    assert store.country_at(178.0, -17.8)["iso2"] == "FJ"  # antimeridian-split country
