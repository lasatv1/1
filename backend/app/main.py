"""Ruster Ball API entry point.

Run locally:  uvicorn app.main:app --reload --port 8000
In production run the API with CTA_RUN_SCHEDULER=false and one `python -m app.worker`.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .cache import open_cache
from .config import get_settings
from .intelligence.adapters.ripestat import RipeStatAdapter
from .intelligence.enrichment.geoip import GeoEnricher
from .runtime import open_store, register_sources
from .scheduler import build_adapters, http_client, run_scheduler
from .security import RateLimitMiddleware, SecurityHeadersMiddleware, configure_logging, unhandled_exception_handler

log = logging.getLogger("cta")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging()
    store = await asyncio.to_thread(open_store, settings)
    cache = open_cache(settings.redis_url.get_secret_value() if settings.redis_url else None)
    geo = GeoEnricher(settings.geolite2_country_db)
    adapters = build_adapters(settings, geo)
    await register_sources(store, adapters)
    app.state.settings = settings
    app.state.store = store
    app.state.cache = cache
    app.state.ripestat = next(a for a in adapters if isinstance(a, RipeStatAdapter))
    app.state.http = http_client(settings)

    tasks: list[asyncio.Task] = []
    if settings.run_scheduler:
        tasks.append(asyncio.create_task(run_scheduler(adapters, store, settings, cache)))
    if cache.enabled:
        # Relay bus messages (from the worker or other instances) to this process's SSE clients.
        tasks.append(asyncio.create_task(cache.listen(store.publish)))
    log.info("API started (store=%s, cache=%s, scheduler=%s)", store.name, cache.name, settings.run_scheduler)
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t
        await app.state.http.aclose()
        await cache.close()
        await asyncio.to_thread(store.close)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type"],
        expose_headers=["X-Cache"],
        allow_credentials=False,
        max_age=600,
    )
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.include_router(router)
    return app


app = create_app()
