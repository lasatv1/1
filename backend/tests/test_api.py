"""API contract & input-validation tests. Network sources are disabled so the tests
never reach third-party services."""
import os

os.environ["CTA_ENABLE_KEYLESS_SOURCES"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()
from app.main import create_app  # noqa: E402


def client():
    os.environ.pop("CTA_REDIS_URL", None)
    get_settings.cache_clear()
    return TestClient(create_app())


def test_health_and_sources_report_status():
    with client() as c:
        assert c.get("/api/health").json()["status"] == "ok"
        sources = c.get("/api/sources").json()
        assert sources and all(s["status"] == "not_configured" for s in sources)
        assert all("statusDetail" in s for s in sources)  # camelCase contract


def test_events_validation():
    with client() as c:
        r = c.get("/api/events")
        assert r.status_code == 200 and r.json()["items"] == []
        assert c.get("/api/events?limit=0").status_code == 422
        assert c.get("/api/events?cursor=%%%").status_code == 400
        assert c.get("/api/events?from=2026-01-01T00:00:00Z&to=2025-01-01T00:00:00Z").status_code == 400


def test_network_rejects_bad_country_code():
    with client() as c:
        assert c.get("/api/network/../../etc").status_code == 404
        assert c.get("/api/network/USA").status_code == 422


def test_security_headers_and_cors():
    with client() as c:
        r = c.get("/api/health", headers={"Origin": "https://evil.example"})
        assert r.headers["x-content-type-options"] == "nosniff"
        assert "access-control-allow-origin" not in r.headers
        r = c.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
