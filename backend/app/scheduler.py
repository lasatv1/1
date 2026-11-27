"""Periodic source synchronisation. Each adapter runs independently; one failing source
marks only itself as degraded/unavailable and never blocks the others."""
from __future__ import annotations

import asyncio
import logging

import httpx

from .config import Settings
from .intelligence.adapters.abuseipdb import AbuseIpdbAdapter
from .intelligence.adapters.base import Adapter
from .intelligence.adapters.cisa_kev import CisaKevAdapter
from .intelligence.adapters.feodo import FeodoAdapter
from .intelligence.adapters.otx import OtxAdapter
from .intelligence.adapters.ripestat import RipeStatAdapter
from .intelligence.adapters.urlhaus import UrlhausAdapter
from .intelligence.enrichment.geoip import GeoEnricher
from .intelligence.normalizers.common import now
from .models import IntelSource
from .security import redact
from .store import MemoryStore  # noqa: F401  (type reference; PostgresStore shares the interface)

log = logging.getLogger("cta.sync")
USER_AGENT = "CyberThreatAtlas/0.1 (+threat-intel visualisation; read-only)"


def build_adapters(settings: Settings, geo: GeoEnricher) -> list[Adapter]:
    return [
        FeodoAdapter(settings, geo),
        CisaKevAdapter(settings, geo),
        OtxAdapter(settings, geo),
        AbuseIpdbAdapter(settings, geo),
        UrlhausAdapter(settings, geo),
        RipeStatAdapter(settings, geo),
    ]


def source_record(a: Adapter, **kw) -> IntelSource:
    return IntelSource(
        id=a.id,
        name=a.name,
        url=a.url,
        attribution_method=a.attribution_method,
        categories=a.categories,
        **{"status": "not_configured", **kw},
    )


def http_client(settings: Settings) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=settings.http_timeout_seconds,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=False,
    )


async def sync_one(a: Adapter, store, client: httpx.AsyncClient, cache=None) -> int:
    """Syncs one adapter; returns the number of new records stored."""
    db = asyncio.to_thread  # store calls may hit the database; keep the event loop free
    if not a.configured():
        await db(store.upsert_source, source_record(a, status="not_configured", status_detail=a.not_configured_reason()))
        return 0
    if isinstance(a, RipeStatAdapter):  # on-demand source
        await db(store.upsert_source, source_record(a, status="ok", status_detail="Queried on demand per country", last_sync=now()))
        return 0
    prev = await db(store.get_source, a.id)
    try:
        raw = await a.fetch(client)
        collected = now()
        batch = a.normalize(raw, collected)
        new = await db(store.upsert_events, batch.events)
        if batch.catalog is not None:
            await db(store.set_catalog, a.id, batch.catalog)
        parts = [batch.detail] if batch.detail else []
        if batch.events:
            newest = max(e.observed_at for e in batch.events)
            recent = sum(1 for e in batch.events if (collected - e.observed_at).days <= 30)
            parts.append(f"{len(batch.events)} records, {recent} observed in last 30 days; newest {newest:%Y-%m-%d}")
        if batch.skipped:
            parts.append(f"{batch.skipped} skipped (no usable geography)")
        detail = " · ".join(parts) or None
        await db(store.upsert_source, source_record(a, status="ok", status_detail=detail, last_sync=collected))
        log.info("synced %s: %d records, %d new, %d skipped", a.id, len(batch.events), new, batch.skipped)
        if new:
            msg = {"sourceId": a.id, "newRecords": new}
            if cache is not None and cache.enabled:
                await cache.bump()  # invalidate cached API responses everywhere
                await cache.publish(msg)  # every API instance relays it to its SSE clients
            else:
                store.publish(msg)
        return new
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        detail = "Credential rejected by source" if code in (401, 403) else f"Source responded HTTP {code}"
        await db(store.upsert_source, source_record(a, status="degraded" if prev and prev.last_sync else "unavailable", status_detail=detail, last_sync=prev.last_sync if prev else None))
        log.warning("sync %s failed: %s", a.id, detail)
        return 0
    except Exception as exc:  # network errors, malformed payloads
        await db(
            store.upsert_source,
            source_record(a, status="degraded" if prev and prev.last_sync else "unavailable", status_detail="Source unreachable or returned unexpected data", last_sync=prev.last_sync if prev else None),
        )
        log.warning("sync %s failed: %s", a.id, redact(type(exc).__name__ + ": " + str(exc))[:300])
        return 0


async def sync_all(adapters: list[Adapter], store, client: httpx.AsyncClient, cache=None) -> int:
    """One full sync cycle; returns the total number of new records."""
    results = await asyncio.gather(*(sync_one(a, store, client, cache) for a in adapters))
    if cache is not None:
        await cache.bump()  # source statuses/catalogues may have changed too
    return sum(results)


async def run_scheduler(adapters: list[Adapter], store, settings: Settings, cache=None) -> None:
    async with http_client(settings) as client:
        while True:
            await sync_all(adapters, store, client, cache)
            await asyncio.sleep(settings.sync_interval_minutes * 60)
