"""Static snapshot export, for hosting without an always-on API (e.g. GitHub Pages).

    python -m app.export --out ../frontend/public/snapshot            # export what's stored
    python -m app.export --sync --out ../frontend/public/snapshot     # sync feeds first

Writes, in the same JSON shapes the API returns:
    meta.json     generation time, window, counts, schema version
    sources.json  intelligence sources with status and provenance
    events.json   observations in the window (newest MAX_EVENTS if larger)
    network.json  stored per-country network statistics

With CTA_DATABASE_URL set (e.g. a free Neon database) history accumulates across runs;
without it, each run exports only what the feeds currently publish.
Credentials are never written to the snapshot.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .config import get_settings
from .intelligence.enrichment.geoip import GeoEnricher
from .runtime import open_store, register_sources
from .scheduler import build_adapters, http_client, sync_all
from .security import configure_logging

log = logging.getLogger("cta.export")
SCHEMA_VERSION = 1
MAX_EVENTS = 60_000  # matches the frontend's live-mode cap
PAGE = 5_000


def _write(path: Path, data) -> None:
    """Atomic write so a half-written file is never published."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


async def export(out: Path, days: int, sync: bool) -> dict:
    settings = get_settings()
    store = await asyncio.to_thread(open_store, settings)
    try:
        if sync:
            adapters = build_adapters(settings, GeoEnricher(settings.geolite2_country_db))
            await register_sources(store, adapters)
            async with http_client(settings) as client:
                new = await sync_all(adapters, store, client)
            log.info("sync finished: %d new records", new)

        now = datetime.now(UTC).replace(second=0, microsecond=0)
        start = now - timedelta(days=days)
        _, total = await asyncio.to_thread(store.events, start, now, 0, 1)
        offset = max(0, total - MAX_EVENTS)  # keep the newest when over the cap
        items = []
        while offset < total:
            page, _ = await asyncio.to_thread(store.events, start, now, offset, PAGE)
            if not page:
                break
            items.extend(e.model_dump(mode="json", by_alias=True) for e in page)
            offset += len(page)

        sources = [s.model_dump(mode="json", by_alias=True) for s in await asyncio.to_thread(store.sources)]
        network = {k: v.model_dump(mode="json", by_alias=True) for k, v in (await asyncio.to_thread(store.all_network)).items()}

        out.mkdir(parents=True, exist_ok=True)
        _write(out / "events.json", {"items": items, "total": total, "truncated": total > len(items)})
        _write(out / "sources.json", sources)
        _write(out / "network.json", network)
        meta = {
            "schema": SCHEMA_VERSION,
            "generatedAt": now.isoformat().replace("+00:00", "Z"),
            "windowStart": start.isoformat().replace("+00:00", "Z"),
            "windowDays": days,
            "events": len(items),
            "store": store.name,
        }
        _write(out / "meta.json", meta)  # written last: its presence means the snapshot is complete
        return meta
    finally:
        await asyncio.to_thread(store.close)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.export", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, type=Path, help="output directory (e.g. ../frontend/public/snapshot)")
    p.add_argument("--days", type=int, default=365, help="observation window to export (default 365)")
    p.add_argument("--sync", action="store_true", help="run one sync cycle before exporting")
    args = p.parse_args(argv)
    if not 1 <= args.days <= 366:
        p.error("--days must be between 1 and 366")
    configure_logging()
    meta = asyncio.run(export(args.out, args.days, args.sync))
    print(f"snapshot written to {args.out}: {meta['events']} events, generated {meta['generatedAt']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
