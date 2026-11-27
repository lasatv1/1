# Operating CyberThreat Atlas

This guide covers running the platform continuously, putting it online, and looking after the database and cache.

## 1. What is running

```
                ┌────────────── edge network ───────────────┐
 browser ──► [caddy :443] ──► [frontend nginx] ──/api──► [backend × N]
              (online only)     static app + proxy           │ stateless API
                                                             │
                ┌───────────── data network (internal, no internet) ─┐
                │  [db  PostGIS]   [redis cache]   [db-backup]       │
                │        ▲              ▲                             │
                └────────┼──────────────┼─────────────────────────────┘
                         └── [worker] ──┘──► intelligence feeds (egress network)
```

| Service | Role | Scale |
|---|---|---|
| `frontend` | nginx serving the built app and proxying `/api` | 1 |
| `backend` | FastAPI, read-only. Stateless, so you can run several. | 1–N |
| `worker` | Fetches sources every `CTA_SYNC_INTERVAL_MINUTES`, writes Postgres, invalidates the cache, announces new data | **exactly 1** |
| `db` | PostgreSQL 17 + PostGIS, the system of record | 1 |
| `redis` | Response cache and message bus. Disposable: no persistence. | 1 |
| `db-backup` | Nightly `pg_dump` to `./backups`, 14-day retention | 1 |
| `caddy` | HTTPS with automatic certificates (production overlay only) | 1 |

Postgres and Redis sit on an internal network. They are never reachable from the host or the internet.

## 2. First start (any machine with Docker)

```powershell
./scripts/new-secrets.ps1        # random DB passwords + backend/.env (run once)
notepad backend/.env             # optional: add OTX / AbuseIPDB / URLhaus keys
docker compose up -d --build
docker compose ps                # every service should be "healthy" or "Up"
```

Open http://localhost:8080. On first start the worker creates the schema, loads country borders and runs a sync.

## 3. Putting it online

You need a Linux server (any VPS with 2 vCPU, 4 GB RAM and 40 GB disk is plenty), with a domain name pointed at it.

1. **DNS**: create an `A`/`AAAA` record, e.g. `atlas.example.org`, pointing to the server's IP.
2. **Server**:
   - install Docker Engine and the compose plugin;
   - open only ports 22, 80 and 443 in the firewall (`ufw allow 22,80,443/tcp`).
3. **Code and secrets**: copy the project to the server (git clone or rsync), then generate the secrets on the server and never copy them anywhere else. On Linux, `pwsh` runs the script; or create the two files by hand with `openssl rand -base64 32`.
4. **Start with HTTPS**:
   ```bash
   export CTA_DOMAIN=atlas.example.org CTA_PUBLIC_ORIGIN=https://atlas.example.org
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
   Caddy obtains and renews Let's Encrypt certificates automatically.
5. **Access control (optional)**: the API is read-only and holds no personal data. If the site should be private anyway, enable `basic_auth` in `deploy/Caddyfile` and restart Caddy.

Updating to a new version:

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Pending migrations apply automatically when the worker and API start. They are advisory-locked, so the two never migrate at the same time.

## 4. Day-to-day checks

| What | Command |
|---|---|
| Overall status | `docker compose ps` |
| Is it ready? | `curl https://atlas.example.org/api/health/ready` returns `{"status":"ready","database":true,"cache":true}` |
| Sync activity | `docker compose logs -f worker` |
| Data freshness per source | `docker compose exec backend python -m app.manage stats` |
| DB and cache reachable | `docker compose exec backend python -m app.manage check` |
| Last backups | `ls backups/` or `docker compose logs db-backup` |

Point an uptime monitor at `/api/health/ready`. It returns HTTP 503 when the database is unreachable. When Redis is down it still returns 200, with `cache: false`, because the API keeps working without it.

## 5. Managing the database

All commands run inside the backend container, which already has the right credentials:

```bash
docker compose exec backend python -m app.manage <command>
```

| Command | Purpose |
|---|---|
| `stats` | Database size, rows and disk usage per table, newest observation per source, applied migrations, cache usage |
| `check` | Connectivity to Postgres (with PostGIS version) and Redis |
| `migrate` | Apply pending migrations (normally automatic) |
| `prune --days 180` | Permanently delete observations older than N days, plus orphaned indicators. Asks you to type `delete`, or pass `--yes`. Then rebuilds aggregates and invalidates the cache. |
| `refresh-relationships` | Rebuild the `country_relationships` aggregate |
| `seed-countries [path]` | Reload Natural Earth borders, e.g. after updating `world.topo.json` |
| `cache-clear` | Drop every cached API response |

Automatic retention: the worker deletes observations older than `CTA_RETENTION_DAYS` (default 365).

### Direct SQL access

```bash
docker compose exec db psql -U cta_admin -d cta          # admin
cta=# set search_path = cta, public;
cta=# select source_id, count(*), max(observed_at) from threat_events group by 1;
```

The application connects as `cta_app`, which owns only the `cta` schema and is not a superuser. `cta_admin` is used only for maintenance and backups.

### Schema changes

1. Add a new file `backend/db/migrations/002_<what>.sql`. Never edit an applied file.
2. Deploy. It applies automatically on start and is recorded in `cta.schema_migrations`.

### Backups and restore

- **Automatic**: `db-backup` writes `backups/cta-YYYYMMDD-HHMMSS.dump` every 24 hours and keeps 14 days. Copy `./backups` off the server regularly (e.g. `rclone` to object storage), because a backup on the same disk does not survive a disk failure.
- **On demand**: `./scripts/db-backup.ps1`
- **Restore**: `./scripts/db-restore.ps1 -File backups/cta-....dump`. In order, it:
  1. takes a `pre-restore-*.dump` safety backup;
  2. stops the API and worker;
  3. recreates the schema;
  4. restores in a single transaction (all or nothing);
  5. restarts the services and clears the cache.
- **Test your backups**: restore one into a scratch stack now and then. A backup you have never restored is unproven.

## 6. Redis cache

- **What is cached:** API responses (sources, event pages, relationships, catalogues, network statistics, country lookups) are stored as ready-made JSON. Every response carries an `X-Cache: HIT|MISS` header.
- **Freshness:** data-dependent entries are keyed by a generation counter that the worker increments after every sync. Cached data is therefore never older than the last sync, and nothing has to be deleted. Old entries expire on their own (10 minutes; 24 hours for country lookups and RIPEstat statistics).
- **Live updates:** the worker publishes "new data" on the `cta:sync` channel. Every API instance relays it to connected browsers over server-sent events, which shows the "N new observations" button.
- **Failure behaviour:** if Redis is unavailable, the API serves directly from Postgres and logs a warning at most every 30 seconds. Nothing breaks; it is only slower.
- **Sizing:** capped at 256 MB with least-recently-used eviction (see `docker-compose.yml`). Redis stores nothing that cannot be rebuilt, so it is never backed up.

## 7. Scaling and troubleshooting

- **More traffic**: `docker compose up -d --scale backend=3`. Keep one worker.
- **A source shows "unavailable"**: check `docker compose logs worker` for the HTTP status. `401`/`403` means the API key was rejected.
- **The globe is empty in Live mode**: run `manage stats` and look at "newest observation". Keyless feeds can be months old; add OTX or AbuseIPDB keys for current data.
- **Rotating database passwords**: change the role password in `psql` (`ALTER ROLE cta_app PASSWORD '…'`), update `backend/db/.db_app_password`, then run `docker compose up -d backend worker`.
