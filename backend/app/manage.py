"""Operator CLI for the database and cache.

    python -m app.manage check                 # can we reach Postgres and Redis?
    python -m app.manage stats                 # sizes, row counts, freshness per source
    python -m app.manage migrate               # apply pending migrations
    python -m app.manage seed-countries [PATH] # (re)load Natural Earth boundaries
    python -m app.manage prune --days 180      # delete observations older than N days
    python -m app.manage refresh-relationships # rebuild the country_relationships aggregate
    python -m app.manage cache-clear           # drop all cached API responses

In Docker:  docker compose exec backend python -m app.manage stats
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .cache import open_cache
from .config import get_settings


def _conn():
    import psycopg  # noqa: PLC0415

    from .db.pool import conninfo  # noqa: PLC0415

    s = get_settings()
    if s.database_url is None:
        sys.exit("CTA_DATABASE_URL is not set — nothing to manage (the API is using its in-memory store).")
    return psycopg.connect(conninfo(s))


def _cache():
    s = get_settings()
    return open_cache(s.redis_url.get_secret_value() if s.redis_url else None)


def cmd_check(_: argparse.Namespace) -> int:
    ok = True
    try:
        with _conn() as c:
            version = c.execute("SELECT postgis_full_version()").fetchone()[0].split(" ")[0:2]
            print(f"database  OK   {' '.join(version)}")
    except SystemExit:
        raise
    except Exception as exc:
        print(f"database  FAIL {type(exc).__name__}: {exc}".split("\n")[0])
        ok = False
    cache = _cache()
    if not cache.enabled:
        print("cache     off  (CTA_REDIS_URL not set)")
    else:
        alive = asyncio.run(_ping(cache))
        print(f"cache     {'OK  ' if alive else 'FAIL'} redis")
    return 0 if ok else 1


async def _ping(cache) -> bool:
    try:
        return await cache.ping()
    finally:
        await cache.close()


def cmd_stats(_: argparse.Namespace) -> int:
    with _conn() as c:
        size = c.execute("SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
        print(f"Database size: {size}\n")
        print(f"{'table':<26}{'rows':>12}{'size':>12}")
        for name in ["threat_events", "threat_event_versions", "indicators", "event_indicators", "network_entities",
                     "catalog_entries", "country_relationships", "countries", "country_network_stats", "investigations"]:
            rows = c.execute(f"SELECT count(*) FROM {name}").fetchone()[0]  # names are constants above
            tsize = c.execute("SELECT pg_size_pretty(pg_total_relation_size(%s::regclass))", (name,)).fetchone()[0]
            print(f"{name:<26}{rows:>12,}{tsize:>12}")
        print(f"\n{'source':<20}{'status':<15}{'events':>8}  {'newest observation':<22}last sync")
        for sid, status, n, newest, last in c.execute(
            """SELECT s.id, s.status, count(e.id), max(e.observed_at), s.last_sync
               FROM intelligence_sources s LEFT JOIN threat_events e ON e.source_id = s.id
               GROUP BY s.id ORDER BY s.id"""
        ):
            fmt = lambda d: d.strftime("%Y-%m-%d %H:%MZ") if d else "-"  # noqa: E731
            print(f"{sid:<20}{status:<15}{n:>8}  {fmt(newest):<22}{fmt(last)}")
        print("\nMigrations applied:", ", ".join(r[0] for r in c.execute("SELECT version FROM schema_migrations ORDER BY version")))
    cache = _cache()
    if cache.enabled:
        print("Cache:", asyncio.run(_stats(cache)))
    return 0


async def _stats(cache):
    try:
        return await cache.stats()
    finally:
        await cache.close()


def cmd_migrate(_: argparse.Namespace) -> int:
    from .db.migrate import migrate  # noqa: PLC0415

    with _conn() as c:
        applied = migrate(c)
    print("applied:", ", ".join(applied) if applied else "nothing (up to date)")
    return 0


def cmd_seed(args: argparse.Namespace) -> int:
    from .db.seed_countries import seed_countries  # noqa: PLC0415

    path = Path(args.path or get_settings().countries_topojson)
    if not path.is_file():
        sys.exit(f"TopoJSON not found: {path}")
    with _conn() as c:
        print("countries seeded:", seed_countries(c, path))
    return 0


def cmd_prune(args: argparse.Namespace) -> int:
    cutoff = datetime.now(UTC) - timedelta(days=args.days)
    with _conn() as c:
        n = c.execute("SELECT count(*) FROM threat_events WHERE observed_at < %s", (cutoff,)).fetchone()[0]
        if not n:
            print("nothing to prune")
            return 0
        if not args.yes and input(f"Permanently delete {n:,} observations older than {cutoff:%Y-%m-%d}? Type 'delete': ") != "delete":
            print("aborted")
            return 1
        with c.transaction():
            c.execute("DELETE FROM threat_events WHERE observed_at < %s", (cutoff,))
            c.execute("DELETE FROM indicators i WHERE NOT EXISTS (SELECT 1 FROM event_indicators ei WHERE ei.indicator_id = i.id)")
    print(f"deleted {n:,} observations (and orphaned indicators)")
    cmd_refresh(args)
    asyncio.run(_bump())
    return 0


def cmd_refresh(_: argparse.Namespace) -> int:
    from .db.postgres_store import PostgresStore  # noqa: PLC0415
    from psycopg_pool import ConnectionPool  # noqa: PLC0415

    from .db.pool import conninfo  # noqa: PLC0415

    with ConnectionPool(conninfo(get_settings()), min_size=1, max_size=1) as pool:
        PostgresStore(pool).refresh_relationships()
    print("country_relationships rebuilt")
    return 0


async def _bump():
    cache = _cache()
    try:
        await cache.bump()
    finally:
        await cache.close()


def cmd_cache_clear(_: argparse.Namespace) -> int:
    async def run():
        cache = _cache()
        try:
            return await cache.clear()
        finally:
            await cache.close()

    if not _cache().enabled:
        print("cache is not configured")
        return 0
    print("deleted keys:", asyncio.run(run()))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.manage", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    sub.add_parser("stats").set_defaults(fn=cmd_stats)
    sub.add_parser("migrate").set_defaults(fn=cmd_migrate)
    s = sub.add_parser("seed-countries")
    s.add_argument("path", nargs="?")
    s.set_defaults(fn=cmd_seed)
    pr = sub.add_parser("prune")
    pr.add_argument("--days", type=int, required=True)
    pr.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    pr.set_defaults(fn=cmd_prune)
    sub.add_parser("refresh-relationships").set_defaults(fn=cmd_refresh)
    sub.add_parser("cache-clear").set_defaults(fn=cmd_cache_clear)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
