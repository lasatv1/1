# CyberThreat Atlas

A geospatial cyber threat intelligence platform. The map is the main interface: a 3D globe or a flat 2D map where every country can be selected on its own. Directed arcs show relationships between countries, and every observation keeps its provenance.

> CyberThreat Atlas only visualises data. It performs no scanning, probing or exploitation, and it never treats IP geolocation as attribution.

## Quick start

```powershell
# Frontend (works on its own with the labelled demonstration dataset)
cd frontend
npm install
npm run dev            # http://localhost:5173

# Backend (optional; enables Live mode)
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
copy .env.example .env  # add API keys if you have them
.venv\Scripts\uvicorn app.main:app --port 8000
```

The dev server proxies `/api` to `127.0.0.1:8000`. If the backend is reachable, the app loads **Live** data. If not, it loads the **Demo** dataset, and a persistent "Demo data" badge marks every view. You can switch between the two in the top bar.

### Persistence (PostgreSQL + PostGIS)

Without `CTA_DATABASE_URL` the backend keeps data in memory, and it is lost on restart. To persist:

```powershell
# A throwaway PostGIS container (port 5433 avoids clashing with a local Postgres on 5432)
docker run -d --name cta-db -p 127.0.0.1:5433:5432 -e POSTGRES_DB=cta -e POSTGRES_USER=cta_admin `
  -e POSTGRES_PASSWORD_FILE=/run/secrets/db_password `
  -v ${PWD}\backend\db\.db_password:/run/secrets/db_password:ro `
  -v ${PWD}\backend\db\.db_app_password:/run/secrets/db_app_password:ro `
  -v ${PWD}\backend\db\init:/docker-entrypoint-initdb.d:ro postgis/postgis:17-3.5

# backend/.env
CTA_DATABASE_URL=postgresql://cta_app@127.0.0.1:5433/cta
CTA_DATABASE_PASSWORD_FILE=C:\path\to\backend\db\.db_app_password
```

On start the API:
1. applies pending migrations from `backend/db/migrations/`, tracked in `schema_migrations` and guarded by an advisory lock;
2. seeds the `countries` table from the same Natural Earth file the globe uses, if the table is empty.

`db/init/00-init.sh` runs once as superuser. It creates PostGIS and a **non-superuser** role, `cta_app`, which owns only the `cta` schema. Passwords are read from files, never from the connection URL.

### Running it as a system

```powershell
./scripts/new-secrets.ps1
docker compose up -d --build   # http://localhost:8080
```

This starts the full stack:
- the API, and a separate sync worker;
- PostGIS;
- Redis, used as the cache and message bus;
- nightly backups.

To put it online with HTTPS, and to manage the database (stats, pruning, migrations, backups and restore, cache), see **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

**Free hosting ($0, no credit card):** see **[docs/DEPLOY-FREE.md](docs/DEPLOY-FREE.md)**. The recommended setup is GitHub Pages plus GitHub Actions plus Neon Postgres, with hourly syncs and a static site. You can also self-host with Tailscale Funnel, or use an Oracle VM if you have a card.

## Using it

| Action | How |
|---|---|
| Select / compare countries | Click / Shift-click a country |
| Investigate a relationship | Hover an arc for a summary, click it for the investigation panel |
| 3D globe ↔ 2D map | Toggle at the top of the map (the 2D map pans and zooms like a pad) |
| Theme | **Mist** (default, mid-tone gray), **Light** or **Black**, in the top bar; remembered per browser |
| Time | Presets 1h/24h/7d/30d, custom range (left panel or drag the timeline overview), playback with speed control |
| Keyboard | `G` global view · `R` reset camera · `F` fullscreen · `/` search · `Esc` close panel · `Space` play/pause |

The 10 intelligence layers each have their own legend, category scope, visual rule (arcs, markers or choropleth) and stated data requirements. A layer with no supporting data says so; it never shows placeholders.

## Data and honesty rules

- **Relationship basis** is shown everywhere: *observed traffic*, *infrastructure geolocation*, *attribution claim* (always labelled as an unverified claim), or *inferred*. The Intelligence Context text for each connection explains why it is shown.
- **Provenance**: every event carries its source, source record ID, and observed, collected and updated timestamps. Re-ingesting a record keeps the original ID, `first_seen` and `collected_at`.
- **Statistics** are computed from the active, filtered dataset. Nothing is hard-coded.
- **Demonstration data** is generated in the browser and flagged `isDemo`. It uses only RFC 5737 documentation IPs, RFC 6996 private ASNs and the `.example` TLD. Activity is distributed by √population, so it implies nothing about real countries.

### Sources (backend adapters, `backend/app/intelligence/adapters/`)

| Source | Key | Mapped as |
|---|---|---|
| abuse.ch Feodo Tracker | none | C2 servers, markers (infrastructure geolocation) |
| CISA KEV | none | Catalogue only (not geographic, never mapped) |
| RIPEstat | none | ASN/prefix counts per country, on demand |
| AlienVault OTX | `CTA_OTX_API_KEY` | Indicators geolocated, correlated with the pulse's targeted countries (inferred arcs) |
| AbuseIPDB | `CTA_ABUSEIPDB_API_KEY` | Reported IPs, markers |
| abuse.ch URLhaus | `CTA_ABUSECH_AUTH_KEY` | Malware URLs with IP-literal hosts, via local GeoLite2 |

Optional IP→country enrichment uses a local MaxMind GeoLite2 database (`CTA_GEOLITE2_COUNTRY_DB`) and makes no network calls. Hostnames are never resolved.

## Architecture

```
frontend/  React 19 · TypeScript (strict) · Vite · Tailwind v4 · three.js / React Three Fiber · Zustand
  scripts/build-geodata.mjs   Natural Earth 50m → TopoJSON + pre-triangulated sphere mesh (world.mesh.bin)
  src/lib/geo                  projection (globe | flat), mesh builders, arcs
  src/lib/data                 demo generator, API client, pure filter/aggregation functions
  src/state                    appStore (filters/selection), globeStore (hover/camera, per-frame),
                               dataStore, derivedStore (single rAF-throttled aggregation pass)
  src/components/globe         WebGL scene: countries (1 draw call), borders, disputed, arcs (shader), markers, labels
backend/   FastAPI · Pydantic v2 · httpx
  app/intelligence/{adapters,normalizers,enrichment,correlation,aggregation}
  app/store.py                 in-memory repository (used when no database is configured)
  app/db/                      PostgresStore (same interface), migration runner, country seeding
  db/migrations/               versioned SQL (PostGIS, provenance, history, indexes)
  db/init/                     one-time superuser init: PostGIS + least-privilege app role
```

How it stays fast:
- Country triangulation (Antarctica alone takes about 3.5s) runs at build time, not in the browser.
- Countries render as one merged mesh with per-vertex recolouring, and all arcs render in a single shader draw call.
- A level-of-detail cap limits arcs drawn, ranked by severity-weighted volume.
- Labels are positioned imperatively, so they cause no React re-renders.
- Event lists are virtualised, filtering uses binary search over sorted timestamps, and three.js is lazy-loaded.

Security:
- Keys are read from server-side environment variables only.
- All API input is validated, CORS is GET-only against an allowlist, and per-IP rate limiting is on.
- Security headers are set, errors are returned without internal detail, and logs are redacted.
- Outbound requests are read-only and do not follow redirects.

## Tests

```powershell
cd frontend; npm test            # aggregation, filtering, projections (vitest)
cd backend;  .venv\Scripts\pytest   # normalisers, provenance, API validation, headers/CORS
# + PostgreSQL integration (dedup, history, PostGIS lookups) against a disposable database:
$env:CTA_TEST_DATABASE_URL="postgresql://user:pass@127.0.0.1:5433/cta_test"; .venv\Scripts\pytest
```

## Not yet implemented

- Saved investigations are still stored in the browser. The `investigations` table exists, but there is no API for it yet.
- Authentication: the API is read-only with no user accounts yet.
- A public ransomware or breach disclosure feed adapter.
- Server-side tile/LOD for very large live datasets.
