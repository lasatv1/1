"""Loads country polygons into PostGIS from the frontend's Natural Earth TopoJSON.

The same file drives the globe, so the database and the map agree exactly on
boundaries. Run automatically when the countries table is empty, or manually:

    python -m app.db.seed_countries ../frontend/public/data/world.topo.json
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

from psycopg import Connection

log = logging.getLogger("cta.db")


def _decode_arcs(topo: dict) -> list[list[list[float]]]:
    """Delta-decodes and de-quantises TopoJSON arcs into [lng, lat] positions."""
    t = topo.get("transform")
    out = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for p in arc:
            if t:
                x += p[0]
                y += p[1]
                pts.append([x * t["scale"][0] + t["translate"][0], y * t["scale"][1] + t["translate"][1]])
            else:
                pts.append([p[0], p[1]])
        out.append(pts)
    return out


def _ring(arcs: list[list[list[float]]], idxs: list[int]) -> list[list[float]]:
    ring: list[list[float]] = []
    for i in idxs:
        pts = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        ring.extend(pts if not ring else pts[1:])  # shared endpoints appear once
    return ring


def topology_features(topo: dict, obj: str) -> list[dict[str, Any]]:
    arcs = _decode_arcs(topo)
    feats = []
    for g in topo["objects"][obj]["geometries"]:
        if g["type"] == "Polygon":
            coords = [[_ring(arcs, r) for r in g["arcs"]]]
        elif g["type"] == "MultiPolygon":
            coords = [[_ring(arcs, r) for r in poly] for poly in g["arcs"]]
        else:
            continue
        feats.append({"properties": g.get("properties", {}), "geometry": {"type": "MultiPolygon", "coordinates": coords}})
    return feats


def seed_countries(conn: Connection, topojson_path: Path) -> int:
    topo = json.loads(topojson_path.read_text(encoding="utf-8"))
    rows = []
    for f in topology_features(topo, "countries"):
        p = f["properties"]
        label = (p.get("labelLng"), p.get("labelLat"))
        rows.append((p["id"], p.get("iso2"), p.get("iso3"), p["name"], p.get("region"), p.get("subregion"),
                     json.dumps(f["geometry"]), label[0], label[1]))
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO countries (id, iso2, iso3, name, region, subregion, geom, label_point)
            VALUES (%s, %s, %s, %s, %s, %s,
                    ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)),
                    CASE WHEN %s::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(%s::float8, %s::float8), 4326) END)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom, label_point = EXCLUDED.label_point,
                region = EXCLUDED.region, subregion = EXCLUDED.subregion
            """,
            [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[7], r[8]) for r in rows],
        )
    log.info("seeded %d countries", len(rows))
    return len(rows)


if __name__ == "__main__":  # pragma: no cover
    import psycopg

    from ..config import get_settings
    from .pool import conninfo

    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(get_settings().countries_topojson)
    with psycopg.connect(conninfo(get_settings())) as c:
        print(seed_countries(c, path))
