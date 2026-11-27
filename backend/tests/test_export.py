"""Static snapshot export: shape matches the API, provenance kept, no secrets leaked."""
import asyncio
import json
from datetime import UTC, datetime

import app.export as export_mod
from app.config import Settings
from app.intelligence.adapters.feodo import FeodoAdapter
from app.intelligence.enrichment.geoip import GeoEnricher
from app.store import MemoryStore


def test_export_writes_api_shaped_snapshot(tmp_path, monkeypatch):
    store = MemoryStore(retention_days=3650)
    now = datetime.now(UTC)
    raw = [{"ip_address": "8.8.4.4", "port": 443, "status": "online", "country": "US",
            "first_seen": now.strftime("%Y-%m-%d %H:%M:%S"), "last_online": now.strftime("%Y-%m-%d")}]
    store.upsert_events(FeodoAdapter(Settings(), GeoEnricher(None)).normalize(raw, now).events)
    monkeypatch.setattr(export_mod, "open_store", lambda settings: store)
    monkeypatch.setenv("CTA_OTX_API_KEY", "super-secret-key-value-123")
    export_mod.get_settings.cache_clear()

    meta = asyncio.run(export_mod.export(tmp_path, days=30, sync=False))

    assert meta["events"] == 1 and meta["schema"] == 1
    events = json.loads((tmp_path / "events.json").read_text())
    e = events["items"][0]
    assert e["sourceId"] == "abusech-feodo" and e["srcCountry"] == "US"  # camelCase, like the API
    assert {"sourceRecordId", "collectedAt", "observedAt", "references"} <= set(e)  # provenance kept
    assert json.loads((tmp_path / "meta.json").read_text())["generatedAt"].endswith("Z")
    for f in tmp_path.iterdir():
        assert "super-secret-key-value-123" not in f.read_text()
    assert not list(tmp_path.glob("*.tmp"))  # atomic writes leave no temp files
    export_mod.get_settings.cache_clear()
