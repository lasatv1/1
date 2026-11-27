"""Redis cache tests. Need a disposable Redis:
    CTA_TEST_REDIS_URL=redis://127.0.0.1:6380/15 pytest tests/test_cache.py
The outage test runs everywhere (it points at a port where nothing listens)."""
import asyncio
import os
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

REDIS = os.environ.get("CTA_TEST_REDIS_URL")
needs_redis = pytest.mark.skipif(not REDIS, reason="CTA_TEST_REDIS_URL not set")


def make_client(monkeypatch, redis_url: str | None):
    monkeypatch.setenv("CTA_ENABLE_KEYLESS_SOURCES", "false")
    monkeypatch.setenv("CTA_RUN_SCHEDULER", "false")
    if redis_url:
        monkeypatch.setenv("CTA_REDIS_URL", redis_url)
    else:
        monkeypatch.delenv("CTA_REDIS_URL", raising=False)
    from app.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    return TestClient(create_app())


def _seed(store):
    from app.config import Settings
    from app.intelligence.adapters.feodo import FeodoAdapter
    from app.intelligence.enrichment.geoip import GeoEnricher

    raw = [{"ip_address": "8.8.4.4", "port": 443, "status": "online", "country": "US",
            "first_seen": "2026-11-01 08:00:00", "last_online": "2026-11-20"}]
    return store.upsert_events(FeodoAdapter(Settings(), GeoEnricher(None)).normalize(raw, datetime.now(UTC)).events)


@needs_redis
def test_hit_miss_and_generation_invalidation(monkeypatch):
    q = "/api/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z"
    with make_client(monkeypatch, REDIS) as c:
        cache = c.app.state.cache
        c.portal.call(cache.clear)
        r1 = c.get(q)
        assert r1.headers["x-cache"] == "MISS" and r1.json()["total"] == 0
        assert c.get(q).headers["x-cache"] == "HIT"
        # New data arrives (as the worker would store it) → bump generation.
        assert _seed(c.app.state.store) == 1
        assert c.get(q).json()["total"] == 0  # still the cached answer until the bump…
        c.portal.call(cache.bump)
        r3 = c.get(q)
        assert r3.headers["x-cache"] == "MISS" and r3.json()["total"] == 1  # …then fresh
        assert c.get("/api/health/ready").json() == {"status": "ready", "database": True, "cache": True}


@needs_redis
def test_bus_relays_to_sse_subscribers(monkeypatch):
    with make_client(monkeypatch, REDIS) as c:
        store, cache = c.app.state.store, c.app.state.cache
        q: asyncio.Queue = c.portal.call(lambda: _queue())
        store.listeners.add(q)
        c.portal.call(asyncio.sleep, 0.3)  # let the subscriber attach
        c.portal.call(cache.publish, {"sourceId": "x", "newRecords": 3})
        msg = c.portal.call(_get, q)
        assert msg == {"sourceId": "x", "newRecords": 3}


async def _queue():
    return asyncio.Queue()


async def _get(q):
    return await asyncio.wait_for(q.get(), timeout=3)


def test_api_survives_redis_outage(monkeypatch):
    with make_client(monkeypatch, "redis://127.0.0.1:1/0") as c:
        r = c.get("/api/sources")
        assert r.status_code == 200 and r.headers["x-cache"] == "MISS"
        body = c.get("/api/health/ready").json()
        assert body["status"] == "ready" and body["cache"] is False
