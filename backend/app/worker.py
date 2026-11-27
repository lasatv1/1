"""Sync worker: fetches and stores intelligence on a schedule, separately from the API.

Run:  python -m app.worker          # long-running, syncs every CTA_SYNC_INTERVAL_MINUTES
      python -m app.worker --once   # one sync cycle, then exit (for cron / GitHub Actions)
Run exactly one worker per deployment; scale the API (which is stateless) instead.
After each sync with new data it bumps the Redis cache generation and publishes on the
bus, so every API instance serves fresh data and notifies its SSE subscribers.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import signal

from .cache import open_cache
from .config import get_settings
from .intelligence.enrichment.geoip import GeoEnricher
from .runtime import open_store, register_sources
from .scheduler import build_adapters, http_client, run_scheduler, sync_all
from .security import configure_logging

log = logging.getLogger("cta.worker")


async def main(once: bool = False) -> int:
    settings = get_settings()
    configure_logging()
    store = await asyncio.to_thread(open_store, settings)
    cache = open_cache(settings.redis_url.get_secret_value() if settings.redis_url else None)
    adapters = build_adapters(settings, GeoEnricher(settings.geolite2_country_db))
    await register_sources(store, adapters)

    if once:
        try:
            async with http_client(settings) as client:
                new = await sync_all(adapters, store, client, cache)
            log.info("single sync cycle finished: %d new records", new)
            return 0
        finally:
            await cache.close()
            await asyncio.to_thread(store.close)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):  # not available on Windows
            loop.add_signal_handler(sig, stop.set)

    log.info("worker started (interval %d min, cache %s)", settings.sync_interval_minutes, cache.name)
    task = asyncio.create_task(run_scheduler(adapters, store, settings, cache))
    try:
        await stop.wait()
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await cache.close()
        await asyncio.to_thread(store.close)
        log.info("worker stopped")
    return 0


if __name__ == "__main__":
    import sys

    with contextlib.suppress(KeyboardInterrupt):
        sys.exit(asyncio.run(main(once="--once" in sys.argv[1:])))
