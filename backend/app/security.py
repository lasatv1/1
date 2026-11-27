"""Platform security controls: rate limiting, security headers, safe errors and
log redaction."""
from __future__ import annotations

import logging
import re
import time
from collections import OrderedDict

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger("cta")

_SECRET_PATTERN = re.compile(
    r"(?i)(x-otx-api-key|auth-key|api[_-]?key|key|token)([\"'=:\s]+)([A-Za-z0-9_\-]{12,})"
)


_URL_CREDENTIALS = re.compile(r"(?i)([a-z][a-z0-9+.-]*://[^:/@\s]+):[^@\s]+@")


def redact(text: str) -> str:
    text = _URL_CREDENTIALS.sub(r"\1:***@", text)
    return _SECRET_PATTERN.sub(lambda m: f"{m.group(1)}{m.group(2)}***", text)


class RedactingFilter(logging.Filter):
    """Masks anything that looks like a credential before it reaches log output."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg, record.args = redact(record.getMessage()), ()
        return True


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    handler.addFilter(RedactingFilter())
    root = logging.getLogger("cta")
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    # httpx logs full request URLs at INFO, which could include query-string keys.
    logging.getLogger("httpx").setLevel(logging.WARNING)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-client token bucket. Bounded LRU so memory cannot grow without limit."""

    def __init__(self, app, per_minute: int, max_clients: int = 10_000) -> None:
        super().__init__(app)
        self.rate = per_minute / 60.0
        self.capacity = float(per_minute)
        self.max_clients = max_clients
        self.buckets: OrderedDict[str, tuple[float, float]] = OrderedDict()

    async def dispatch(self, request: Request, call_next):
        if request.url.path.endswith("/stream"):
            return await call_next(request)
        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        tokens, last = self.buckets.pop(client, (self.capacity, now))
        tokens = min(self.capacity, tokens + (now - last) * self.rate)
        if tokens < 1:
            self.buckets[client] = (tokens, now)
            return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429, headers={"Retry-After": "10"})
        self.buckets[client] = (tokens - 1, now)
        if len(self.buckets) > self.max_clients:
            self.buckets.popitem(last=False)
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if not request.url.path.endswith("/stream"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Never echo internal details (paths, upstream URLs, credentials) to clients.
    log.error("Unhandled error on %s: %s", request.url.path, redact(repr(exc)))
    return JSONResponse({"detail": "Internal server error"}, status_code=500)
