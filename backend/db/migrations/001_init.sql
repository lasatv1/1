-- 001: core schema. Applied automatically by app/db/migrate.py (tracked in schema_migrations).
-- Requires the PostGIS extension, which is created by the superuser init script
-- (db/init/00-init.sh) — the application role is deliberately not a superuser.
--
-- Provenance: every observation keeps its source, source record id and
-- collected/observed/updated timestamps; each re-ingestion is kept in
-- threat_event_versions, so history is never overwritten.
-- Country codes on events are plain validated codes (no FK): feeds may legitimately
-- report codes for territories that have no Natural Earth polygon.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE countries (
    id          text PRIMARY KEY,               -- ISO alpha-2, or Natural Earth ADM0_A3 when none
    iso2        char(2),
    iso3        char(3),
    name        text NOT NULL,
    region      text,
    subregion   text,
    geom        geometry(MultiPolygon, 4326) NOT NULL,
    label_point geometry(Point, 4326)
);
CREATE INDEX countries_geom_gix ON countries USING gist (geom);
CREATE INDEX countries_iso2_idx ON countries (iso2);

CREATE TABLE intelligence_sources (
    id                 text PRIMARY KEY,
    name               text NOT NULL,
    source_url         text,
    status             text NOT NULL CHECK (status IN ('ok','degraded','unavailable','not_configured','demo')),
    status_detail      text,
    last_sync          timestamptz,
    attribution_method text NOT NULL,
    categories         text[] NOT NULL DEFAULT '{}',
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE threat_events (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id        text NOT NULL UNIQUE,
    source_id        text NOT NULL REFERENCES intelligence_sources(id),
    source_record_id text NOT NULL,
    category         text NOT NULL CHECK (category IN ('malware','ransomware','phishing','botnet','c2','breach','vulnerability','scanning','network')),
    severity         text NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
    confidence       smallint NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    basis            text NOT NULL CHECK (basis IN ('observed_traffic','infrastructure_geolocation','attribution_claim','inferred')),
    src_country      text CHECK (src_country ~ '^[A-Z0-9]{2,3}$'),
    dst_country      text CHECK (dst_country ~ '^[A-Z0-9]{2,3}$'),
    src_ip           inet,
    dst_ip           inet,
    src_asn          bigint,
    dst_asn          bigint,
    src_org          text,
    first_seen       timestamptz NOT NULL,
    last_seen        timestamptz NOT NULL,
    observed_at      timestamptz NOT NULL,
    collected_at     timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    description      text NOT NULL,
    refs             jsonb NOT NULL DEFAULT '[]'::jsonb,
    UNIQUE (source_id, source_record_id)
);
CREATE INDEX threat_events_observed_idx ON threat_events (observed_at, public_id);
CREATE INDEX threat_events_pair_idx     ON threat_events (src_country, dst_country, category);
CREATE INDEX threat_events_src_ip_idx   ON threat_events (src_ip);

CREATE TABLE threat_event_versions (
    event_id     bigint NOT NULL REFERENCES threat_events(id) ON DELETE CASCADE,
    collected_at timestamptz NOT NULL,
    payload      jsonb NOT NULL,
    PRIMARY KEY (event_id, collected_at)
);

CREATE TABLE indicators (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type       text NOT NULL CHECK (type IN ('ipv4','ipv6','domain','url','sha256','md5','cve','asn')),
    value      text NOT NULL,
    first_seen timestamptz NOT NULL,
    last_seen  timestamptz NOT NULL,
    UNIQUE (type, value)
);

CREATE TABLE event_indicators (
    event_id     bigint NOT NULL REFERENCES threat_events(id) ON DELETE CASCADE,
    indicator_id bigint NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, indicator_id)
);
CREATE INDEX event_indicators_indicator_idx ON event_indicators (indicator_id);

-- Network infrastructure seen in observations (IP → ASN/org/country as reported by the source).
CREATE TABLE network_entities (
    ip_address   inet NOT NULL,
    source_id    text NOT NULL REFERENCES intelligence_sources(id),
    asn          bigint,
    country_code text,
    organization text,
    first_seen   timestamptz NOT NULL,
    last_seen    timestamptz NOT NULL,
    PRIMARY KEY (ip_address, source_id)
);
CREATE INDEX network_entities_asn_idx ON network_entities (asn);

CREATE TABLE country_network_stats (
    country       text PRIMARY KEY,
    asn_count     integer,
    ipv4_prefixes integer,
    ipv6_prefixes integer,
    source        text NOT NULL,
    observed_at   timestamptz NOT NULL,
    fetched_at    timestamptz NOT NULL DEFAULT now()
);

-- Non-geographic catalogues (e.g. CISA KEV): listed, never mapped.
CREATE TABLE catalog_entries (
    source_id            text NOT NULL REFERENCES intelligence_sources(id),
    entry_id             text NOT NULL,
    title                text NOT NULL,
    vendor               text,
    product              text,
    date_added           timestamptz,
    due_date             timestamptz,
    known_ransomware_use boolean,
    reference            text,
    PRIMARY KEY (source_id, entry_id)
);
CREATE INDEX catalog_entries_added_idx ON catalog_entries (source_id, date_added DESC);

-- All-time aggregate, refreshed after each sync. Bases are kept so inferred
-- relationships are never presented as verified attribution.
CREATE TABLE country_relationships (
    source_country      text NOT NULL,
    destination_country text NOT NULL,
    category            text NOT NULL,
    bases               text[] NOT NULL,
    event_count         integer NOT NULL,
    first_seen          timestamptz NOT NULL,
    last_seen           timestamptz NOT NULL,
    PRIMARY KEY (source_country, destination_country, category)
);

CREATE TABLE investigations (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title       text NOT NULL CHECK (length(title) <= 300),
    description text,
    target      jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
