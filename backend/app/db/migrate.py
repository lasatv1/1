"""Minimal, ordered SQL migration runner.

Files in db/migrations/NNN_name.sql are applied once each, in order, inside a
transaction, and recorded in schema_migrations. A Postgres advisory lock prevents two
API instances from migrating concurrently.
"""
from __future__ import annotations

import logging
from pathlib import Path

from psycopg import Connection

log = logging.getLogger("cta.db")
MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"
_LOCK_ID = 7_302_419_001


def migrate(conn: Connection, directory: Path = MIGRATIONS) -> list[str]:
    applied_now: list[str] = []
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_ID,))
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        for path in sorted(directory.glob("*.sql")):
            version = path.stem
            if version in done:
                continue
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
            applied_now.append(version)
    for v in applied_now:
        log.info("applied migration %s", v)
    return applied_now
