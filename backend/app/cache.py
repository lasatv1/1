"""Redis cache + message bus.

Caching strategy
----------------
* Responses are cached as ready-to-send JSON under ``cta:<generation>:<name>:<params>``.
* ``cta:gen`` is a generation counter. Whenever a sync stores new data the worker bumps
  it, so every API instance immediately stops reading the old entries (no key scanning,
  no stale data). Old generations simply expire via their TTL.
* Data that does not change with syncs (country-at-point lookups, RIPEstat facts) uses
  unversioned keys with a long TTL.

Resilience: Redis is an optimisation, never a dependency. Any Redis error is logged
(rate-limited) and the request falls through to the database. Without CTA_REDIS_URL a
``NullCache`` with the same interface is used.

Bus: sync notifications are published on ``cta:sync`` so every API instance (and its
SSE subscribers) hears about new data, even though syncing runs in a separate worker.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

log = logging.getLogger("cta.cache")

CHANNEL = "cta:sync"
GEN_KEY = "cta:gen"


class NullCache:
    enabled = False
    name = "none"

    async def get(self, key: str) -> bytes | None:
        return None

    async def set(self, key: str, value: bytes, ttl: int) -> None:
        return None

    async def versioned_key(self, name: str, params: dict[str, Any] | None = None) -> str:
        return _key("0", name, params)

    async def bump(self) -> None:
        return None

    async def publish(self, message: dict) -> None:
        return None

    async def ping(self) -> bool:
        return True

    async def clear(self) -> int:
        return 0

    async def stats(self) -> dict:
        return {"enabled": False}

    async def listen(self, on_message: Callable[[dict], Awaitable[None] | None]) -> None:
        await asyncio.Event().wait()  # nothing to listen to

    async def close(self) -> None:
        return None


def _key(gen: str, name: str, params: dict[str, Any] | None) -> str:
    if not params:
        return f"cta:{gen}:{name}"
    digest = hashlib.sha256(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:24]
    return f"cta:{gen}:{name}:{digest}"


class RedisCache:
    enabled = True
    name = "redis"

    def __init__(self, url: str) -> None:
        from redis.asyncio import Redis  # noqa: PLC0415

        self.r = Redis.from_url(url, socket_timeout=1.0, socket_connect_timeout=1.0, health_check_interval=30)
        self._last_error = 0.0
        self._gen: tuple[str, float] | None = None
        self.hits = 0
        self.misses = 0

    def _fail(self, op: str, exc: Exception) -> None:
        now = time.monotonic()
        if now - self._last_error > 30:  # don't flood logs while Redis is down
            log.warning("redis %s failed (%s); serving without cache", op, type(exc).__name__)
            self._last_error = now

    async def get(self, key: str) -> bytes | None:
        try:
            value = await self.r.get(key)
        except Exception as exc:
            self._fail("get", exc)
            return None
        if value is None:
            self.misses += 1
        else:
            self.hits += 1
        return value

    async def set(self, key: str, value: bytes, ttl: int) -> None:
        try:
            await self.r.set(key, value, ex=ttl)
        except Exception as exc:
            self._fail("set", exc)

    async def _generation(self) -> str:
        # Cache the counter locally for 1s: at most one extra round-trip per second.
        now = time.monotonic()
        if self._gen and now - self._gen[1] < 1.0:
            return self._gen[0]
        try:
            gen = (await self.r.get(GEN_KEY) or b"0").decode()
        except Exception as exc:
            self._fail("gen", exc)
            gen = "x"  # unique namespace while degraded
        self._gen = (gen, now)
        return gen

    async def versioned_key(self, name: str, params: dict[str, Any] | None = None) -> str:
        return _key(await self._generation(), name, params)

    async def bump(self) -> None:
        try:
            await self.r.incr(GEN_KEY)
            self._gen = None
        except Exception as exc:
            self._fail("bump", exc)

    async def publish(self, message: dict) -> None:
        try:
            await self.r.publish(CHANNEL, json.dumps(message))
        except Exception as exc:
            self._fail("publish", exc)

    async def ping(self) -> bool:
        try:
            return bool(await self.r.ping())
        except Exception:
            return False

    async def clear(self) -> int:
        """Deletes all cta:* keys (operator command)."""
        n = 0
        async for key in self.r.scan_iter(match="cta:*", count=500):
            n += await self.r.delete(key)
        return n

    async def stats(self) -> dict:
        info = await self.r.info(section="memory")
        keys = 0
        async for _ in self.r.scan_iter(match="cta:*", count=1000):
            keys += 1
        return {"enabled": True, "keys": keys, "usedMemory": info.get("used_memory_human"), "hits": self.hits, "misses": self.misses}

    async def listen(self, on_message: Callable[[dict], Awaitable[None] | None]) -> None:
        """Forwards bus messages to on_message forever, reconnecting with backoff."""
        delay = 1.0
        while True:
            try:
                pubsub = self.r.pubsub()
                await pubsub.subscribe(CHANNEL)
                delay = 1.0
                async for msg in pubsub.listen():
                    if msg.get("type") != "message":
                        continue
                    try:
                        result = on_message(json.loads(msg["data"]))
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception:
                        log.warning("ignoring malformed bus message")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._fail("subscribe", exc)
                await asyncio.sleep(delay)
                delay = min(30.0, delay * 2)

    async def close(self) -> None:
        await self.r.aclose()


def open_cache(url: str | None) -> NullCache | RedisCache:
    return RedisCache(url) if url else NullCache()
