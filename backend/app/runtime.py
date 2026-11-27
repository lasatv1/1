"""Shared start-up for the API process and the sync worker."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from .config import Settings
from .intelligence.adapters.base import Adapter
from .scheduler import source_record
from .store import MemoryStore

log = logging.getLogger("cta")


def open_store(settings: Settings):
    """PostgreSQL when CTA_DATABASE_URL is set (migrated + seeded on start), else in-memory."""
    if settings.database_url is None:
        log.warning("CTA_DATABASE_URL not set: using in-memory store (data is lost on restart)")
        return MemoryStore(settings.retention_days)
    from psycopg_pool import ConnectionPool  # noqa: PLC0415

    from .db.migrate import migrate  # noqa: PLC0415
    from .db.pool import conninfo  # noqa: PLC0415
    from .db.postgres_store import PostgresStore  # noqa: PLC0415
    from .db.seed_countries import seed_countries  # noqa: PLC0415

    info = conninfo(settings)
    # Transaction-mode poolers (e.g. Neon "-pooler" hosts, PgBouncer) don't reliably support
    # server-side prepared statements across transactions, so disable auto-prepare there.
    pooled = "-pooler." in info or "pgbouncer" in info
    kwargs = {"prepare_threshold": None} if pooled else {}
    pool = ConnectionPool(info, min_size=1, max_size=settings.db_pool_max, open=True, timeout=10, kwargs=kwargs)
    store = PostgresStore(pool, settings.retention_days)
    with pool.connection() as conn:
        migrate(conn)  # advisory-locked: safe when API and worker start together
    if store.countries_count() == 0:
        path = Path(settings.countries_topojson)
        if path.is_file():
            with pool.connection() as conn:
                seed_countries(conn, path)
        else:
            log.warning("countries table empty and %s not found; PostGIS lookups disabled until seeded", path.name)
    log.info("using PostgreSQL store")
    return store


async def register_sources(store, adapters: list[Adapter]) -> None:
    for a in adapters:
        if not a.configured():
            await asyncio.to_thread(store.upsert_source, source_record(a, status="not_configured", status_detail=a.not_configured_reason()))
        elif await asyncio.to_thread(store.get_source, a.id) is None:
            # Only brand-new sources get a placeholder; persisted status survives restarts.
            await asyncio.to_thread(store.upsert_source, source_record(a, status="degraded", status_detail="Awaiting first sync"))
