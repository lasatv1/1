"""Read-only HTTP API. All inputs are validated; no endpoint triggers outbound scans or
lookups against indicators.

Responses are served from the Redis cache when possible (header ``X-Cache: HIT``).
Data-dependent entries are keyed by the cache generation, which the sync worker bumps
after storing new data, so cached responses are never staler than the last sync.
"""
from __future__ import annotations

import asyncio
import base64
import json
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ..cache import _key
from ..models import CatalogEntry, CountryNetworkFacts, EventPage, IntelSource, RelationshipAggregate

router = APIRouter(prefix="/api")
NETWORK_TTL = 24 * 3600
_network_fetched: dict[str, float] = {}  # fallback freshness tracking when Redis is absent

TTL_SOURCES = 30
TTL_DATA = 600
TTL_STATIC = 24 * 3600


def _store(request: Request):
    return request.app.state.store


async def _db(fn, *args):
    """Runs a (possibly blocking) store call in a worker thread."""
    return await asyncio.to_thread(fn, *args)


async def _cached(
    request: Request,
    name: str,
    params: dict[str, Any] | None,
    ttl: int,
    produce: Callable[[], Awaitable[Any]],
    versioned: bool = True,
) -> Response:
    cache = request.app.state.cache
    key = await cache.versioned_key(name, params) if versioned else _key("static", name, params)
    hit = await cache.get(key)
    if hit is not None:
        return Response(hit, media_type="application/json", headers={"X-Cache": "HIT"})
    body = json.dumps(jsonable_encoder(await produce()), separators=(",", ":")).encode()
    await cache.set(key, body, ttl)
    return Response(body, media_type="application/json", headers={"X-Cache": "MISS" if cache.enabled else "BYPASS"})


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(json.dumps({"o": offset}).encode()).decode()


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        offset = int(json.loads(base64.urlsafe_b64decode(cursor.encode()))["o"])
    except Exception as exc:
        raise HTTPException(400, "Invalid cursor") from exc
    if offset < 0 or offset > 10_000_000:
        raise HTTPException(400, "Invalid cursor")
    return offset


def _window(start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
    # A missing 'to' is rounded up to the minute so repeated requests share cache entries.
    if end is None:
        now = datetime.now(UTC)
        end = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
    end = end.astimezone(UTC)
    start = (start or end - timedelta(days=7)).astimezone(UTC)
    if start > end:
        raise HTTPException(400, "'from' must be before 'to'")
    if end - start > timedelta(days=366):
        raise HTTPException(400, "Window too large (max 366 days)")
    return start, end


@router.get("/health")
async def health(request: Request) -> dict:
    """Liveness: the process is up. Cheap, no dependencies."""
    s = request.app.state
    return {"status": "ok", "version": s.settings.version, "store": s.store.name, "cache": s.cache.name}


@router.get("/health/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness: database (and Redis, if configured) are reachable."""
    s = request.app.state
    db_ok = await _db(s.store.ping)
    cache_ok = await s.cache.ping()
    ok = db_ok  # Redis is optional: degraded, not down
    body = {"status": "ready" if ok else "unavailable", "database": db_ok, "cache": cache_ok if s.cache.enabled else None}
    return JSONResponse(body, status_code=200 if ok else 503)


@router.get("/sources", response_model=list[IntelSource])
async def sources(request: Request) -> Response:
    return await _cached(request, "sources", None, TTL_SOURCES, lambda: _db(_store(request).sources))


@router.get("/events", response_model=EventPage)
async def events(
    request: Request,
    start: Annotated[datetime | None, Query(alias="from")] = None,
    end: Annotated[datetime | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=5000)] = 1000,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> Response:
    start, end = _window(start, end)
    offset = _decode_cursor(cursor)

    async def produce() -> EventPage:
        items, total = await _db(_store(request).events, start, end, offset, limit)
        nxt = offset + len(items)
        return EventPage(items=items, next_cursor=_encode_cursor(nxt) if nxt < total else None, total=total)

    return await _cached(request, "events", {"s": start, "e": end, "o": offset, "l": limit}, TTL_DATA, produce)


@router.get("/relationships", response_model=list[RelationshipAggregate])
async def relationships(
    request: Request,
    start: Annotated[datetime | None, Query(alias="from")] = None,
    end: Annotated[datetime | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
) -> Response:
    start, end = _window(start, end)
    return await _cached(
        request, "relationships", {"s": start, "e": end, "l": limit}, TTL_DATA, lambda: _db(_store(request).relationships, start, end, limit)
    )


@router.get("/network", response_model=dict[str, CountryNetworkFacts])
async def network_all(request: Request) -> Response:
    return await _cached(request, "network", None, TTL_DATA, lambda: _db(_store(request).all_network))


@router.get("/network/{cc}", response_model=CountryNetworkFacts)
async def network_country(request: Request, cc: Annotated[str, Path(pattern=r"^[A-Za-z]{2}$")]) -> Response:
    cc = cc.upper()

    async def produce() -> CountryNetworkFacts:
        store = _store(request)
        cached = await _db(store.get_network, cc)
        if cached and time.time() - _network_fetched.get(cc, 0) < NETWORK_TTL:
            return cached
        ripe = request.app.state.ripestat
        if not ripe.configured():
            raise HTTPException(503, "Network registry source not configured")
        try:
            facts = await ripe.country_facts(request.app.state.http, cc)
        except Exception as exc:
            if cached:
                return cached
            raise HTTPException(502, "Network registry source unavailable") from exc
        await _db(store.set_network, facts)
        _network_fetched[cc] = time.time()
        return facts

    # RIPEstat statistics change slowly: cache for a day, shared by all API instances.
    return await _cached(request, "network-cc", {"cc": cc}, TTL_STATIC, produce, versioned=False)


@router.get("/catalog/{source_id}", response_model=list[CatalogEntry])
async def catalog(
    request: Request,
    source_id: Annotated[str, Path(pattern=r"^[a-z0-9-]{1,40}$")],
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
) -> Response:
    async def produce():
        return (await _db(_store(request).catalog, source_id))[:limit]

    return await _cached(request, "catalog", {"src": source_id, "l": limit}, TTL_DATA, produce)


@router.get("/countries/at")
async def country_at(
    request: Request,
    lng: Annotated[float, Query(ge=-180, le=180)],
    lat: Annotated[float, Query(ge=-90, le=90)],
) -> Response:
    """PostGIS point-in-polygon lookup against the Natural Earth boundaries."""
    store = _store(request)
    if store.name != "postgres":
        raise HTTPException(501, "Geographic queries require the PostgreSQL/PostGIS store")
    # ~1 m precision is plenty for a country lookup and keeps the cache key space bounded.
    lng, lat = round(lng, 5), round(lat, 5)

    async def produce():
        hit = await _db(store.country_at, lng, lat)
        if not hit:
            raise HTTPException(404, "No country at this location (ocean or unmapped)")
        return hit

    return await _cached(request, "country-at", {"lng": lng, "lat": lat}, TTL_STATIC, produce, versioned=False)


@router.get("/stream")
async def stream(request: Request) -> StreamingResponse:
    """Server-sent events: announces new observations after each sync."""
    store = _store(request)
    if len(store.listeners) >= 500:
        raise HTTPException(503, "Too many subscribers")
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=100)
    store.listeners.add(queue)

    async def gen():
        try:
            yield "retry: 15000\n\n"
            while not await request.is_disconnected():
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"event: sync\ndata: {json.dumps(msg)}\n\n"
                except TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            store.listeners.discard(queue)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
