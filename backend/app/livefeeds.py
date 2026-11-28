"""Publishes live-layer data for providers that browsers cannot call directly (no CORS).

    python -m app.livefeeds --out ../frontend/public/live

Run by the scheduled GitHub job (every 15 minutes). Each feed is independent: a provider
failure skips only that file and is recorded in status.json; nothing else is affected.

    flights.json   OpenSky Network state vectors (airborne aircraft worldwide)
    military.json  adsb.lol military-flagged aircraft
    cables.json    TeleGeography submarine cable routes (CC BY-NC-SA 3.0, non-commercial)
    conflict.json  GDELT 2.0 events coded as assault / fight / mass violence / protest,
                   rolling 24 h (merged with the previously published file)
    ships.json     AISStream global vessel positions with short trails (needs the free
                   CTA_AISSTREAM_API_KEY; skipped without it)

Trails and rolling windows need the previous run's output; CTA_PUBLISHED_BASE (the
public URL of the live/ folder) lets each run continue from what is already published.

Row format for aircraft (compact):
    [icao24, callsign, lng, lat, altitude_m|null, speed_m_s|null, heading_deg|null, country, type]
"""
from __future__ import annotations

import argparse
import asyncio
import calendar
import csv
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path

import httpx

UA = "CyberThreatAtlas/0.1 (+threat-intel visualisation; scheduled, read-only)"


def _write(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _r(x, nd=3):
    return round(x, nd) if isinstance(x, (int, float)) else None


def opensky(client: httpx.Client) -> dict:
    r = client.get("https://opensky-network.org/api/states/all")
    r.raise_for_status()
    d = r.json()
    rows = []
    for s in d.get("states") or []:
        lng, lat, on_ground = s[5], s[6], s[8]
        if lng is None or lat is None or on_ground:
            continue
        alt = s[13] if s[13] is not None else s[7]
        rows.append([s[0], (s[1] or "").strip(), _r(lng), _r(lat), _r(alt, 0), _r(s[9], 1), _r(s[10], 0), s[2] or "", ""])
    return {"time": d.get("time") or int(time.time()), "source": "OpenSky Network", "rows": rows}


def adsblol_military(client: httpx.Client) -> dict:
    r = client.get("https://api.adsb.lol/v2/mil")
    r.raise_for_status()
    d = r.json()
    rows = []
    for a in d.get("ac") or []:
        lat, lng = a.get("lat"), a.get("lon")
        alt_ft = a.get("alt_baro")
        if lat is None or lng is None or alt_ft == "ground":
            continue
        alt_m = alt_ft * 0.3048 if isinstance(alt_ft, (int, float)) else None
        gs_ms = a["gs"] / 1.94384 if isinstance(a.get("gs"), (int, float)) else None
        hdg = a.get("true_heading", a.get("track"))
        rows.append([a.get("hex", ""), (a.get("flight") or a.get("r") or "").strip(), _r(lng), _r(lat), _r(alt_m, 0), _r(gs_ms, 1), _r(hdg, 0), "", a.get("t") or ""])
    now = d.get("now")
    return {"time": int(now / 1000) if now else int(time.time()), "source": "adsb.lol", "rows": rows}


def cables(client: httpx.Client) -> dict:
    r = client.get("https://www.submarinecablemap.com/api/v3/cable/cable-geo.json")
    r.raise_for_status()
    out = []
    for f in r.json().get("features", []):
        g = f.get("geometry") or {}
        lines = g.get("coordinates") if g.get("type") == "MultiLineString" else [g.get("coordinates")] if g.get("type") == "LineString" else []
        coords = [[[round(p[0], 2), round(p[1], 2)] for p in line] for line in lines if line]
        if coords:
            p = f.get("properties") or {}
            out.append({"id": str(p.get("id") or p.get("feature_id") or len(out)), "name": p.get("name") or "Unnamed cable", "coords": coords})
    return {"time": int(time.time()), "source": "TeleGeography Submarine Cable Map (CC BY-NC-SA 3.0)", "cables": out}


def previous(client: httpx.Client, name: str) -> dict | None:
    """The currently published version of a file, to continue rolling windows/trails."""
    base = os.environ.get("CTA_PUBLISHED_BASE", "").rstrip("/")
    if not base.startswith("https://"):
        return None
    try:
        r = client.get(f"{base}/{name}")
        return r.json() if r.status_code == 200 and "json" in r.headers.get("content-type", "") else None
    except Exception:
        return None


# CAMEO root codes: 14 protest, 18 assault, 19 fight, 20 unconventional mass violence.
CONFLICT_ROOTS = {"14": "Protest", "18": "Assault", "19": "Fighting", "20": "Mass violence"}
CONFLICT_WINDOW_S = 24 * 3600
CONFLICT_CAP = 4000


def gdelt_conflict(client: httpx.Client) -> dict:
    idx = client.get("https://data.gdeltproject.org/gdeltv2/lastupdate.txt")
    idx.raise_for_status()
    listed = idx.text.split("\n")[0].split()[-1]
    # GDELT announces a new 15-minute slice shortly before the file is actually served, so
    # if the newest slice 404s, fall back to the previous ones. Nothing is lost: the merged
    # 24 h window picks the newest slice up on the next run.
    stamp = listed.rsplit("/", 1)[-1].split(".")[0]  # e.g. 20261128124500
    base_t = calendar.timegm(time.strptime(stamp, "%Y%m%d%H%M%S"))
    z = None
    for back in range(4):
        slice_stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime(base_t - back * 900))
        url = f"http://data.gdeltproject.org/gdeltv2/{slice_stamp}.export.CSV.zip"
        z = client.get(url, follow_redirects=True)
        if z.status_code == 200:
            break
    assert z is not None
    z.raise_for_status()
    now = int(time.time())
    events: dict[str, list] = {}
    with zipfile.ZipFile(io.BytesIO(z.content)) as zf:
        reader = csv.reader(io.TextIOWrapper(zf.open(zf.namelist()[0]), encoding="utf-8", errors="replace"), delimiter="\t")
        for r in reader:
            if len(r) < 61 or r[28] not in CONFLICT_ROOTS or not r[56] or not r[57]:
                continue
            try:
                lat, lng = float(r[56]), float(r[57])
                added = calendar.timegm(time.strptime(r[59], "%Y%m%d%H%M%S"))  # DATEADDED is UTC
            except ValueError:
                continue
            # [id, unix, root, code, actor1, actor2, place, lng, lat, goldstein, mentions, url]
            events[r[0]] = [r[0], added, r[28], r[26], r[6], r[16], r[52], round(lng, 3), round(lat, 3), float(r[30] or 0), int(r[31] or 0), r[60]]
    prev = previous(client, "conflict.json") or {}
    for e in prev.get("events", []):
        if now - e[1] <= CONFLICT_WINDOW_S:
            events.setdefault(e[0], e)
    rows = sorted(events.values(), key=lambda e: e[1], reverse=True)[:CONFLICT_CAP]
    return {"time": now, "source": "GDELT 2.0 Event Database", "window_s": CONFLICT_WINDOW_S, "events": rows}


AIS_COLLECT_S = 90
TRAIL_POINTS = 8
TRAIL_MAX_AGE_S = 6 * 3600


async def _ais_collect(key: str) -> dict[int, dict]:
    import websockets  # noqa: PLC0415

    ships: dict[int, dict] = {}
    sub = {"APIKey": key, "BoundingBoxes": [[[-90, -180], [90, 180]]], "FilterMessageTypes": ["PositionReport", "ShipStaticData"]}
    deadline = time.time() + AIS_COLLECT_S
    # compression=None: AISStream stalls the handshake when permessage-deflate is offered.
    async with websockets.connect("wss://stream.aisstream.io/v0/stream", open_timeout=40, max_size=2**20, compression=None) as ws:
        await ws.send(json.dumps(sub))
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.time()))
            except TimeoutError:
                break
            m = json.loads(raw)
            meta = m.get("MetaData") or {}
            mmsi = meta.get("MMSI")
            if not mmsi:
                continue
            s = ships.setdefault(mmsi, {"name": (meta.get("ShipName") or "").strip()})
            if m.get("MessageType") == "PositionReport":
                pr = m["Message"]["PositionReport"]
                if abs(pr.get("Latitude", 91)) <= 90 and abs(pr.get("Longitude", 181)) <= 180:
                    s.update(lat=round(pr["Latitude"], 4), lng=round(pr["Longitude"], 4), sog=pr.get("Sog"), cog=pr.get("Cog"),
                             hdg=pr.get("TrueHeading") if pr.get("TrueHeading", 511) != 511 else None, nav=pr.get("NavigationalStatus"))
            elif m.get("MessageType") == "ShipStaticData":
                sd = m["Message"]["ShipStaticData"]
                s.update(type=sd.get("Type"), dest=(sd.get("Destination") or "").strip(), callsign=(sd.get("CallSign") or "").strip())
    return ships


def aisstream_ships(client: httpx.Client) -> dict:
    key = os.environ.get("CTA_AISSTREAM_API_KEY", "").strip()
    if not key:
        raise RuntimeError("CTA_AISSTREAM_API_KEY not set (free key from aisstream.io)")
    seen = asyncio.run(_ais_collect(key))
    now = int(time.time())
    prev = {r[0]: r for r in (previous(client, "ships.json") or {}).get("rows", [])}
    rows = []
    for mmsi, s in seen.items():
        if "lat" not in s:
            continue
        old = prev.get(mmsi)
        trail = [pt for pt in (old[9] if old else []) if now - pt[2] <= TRAIL_MAX_AGE_S]
        if old:
            trail.append([old[2], old[3], old[10]])
        # [mmsi, name, lng, lat, sog_kn, cog, heading, type, dest, trail[[lng,lat,t]], t]
        rows.append([mmsi, s.get("name") or (old[1] if old else ""), s["lng"], s["lat"], s.get("sog"), s.get("cog"), s.get("hdg"),
                     s.get("type", old[7] if old else None), s.get("dest") or (old[8] if old else ""), trail[-TRAIL_POINTS:], now])
    # Keep ships not heard this run (AIS is bursty) for up to an hour, so the map doesn't flicker.
    for mmsi, old in prev.items():
        if mmsi not in seen and now - old[10] <= 3600:
            rows.append(old)
    return {"time": now, "source": "AISStream.io", "rows": rows}


FEEDS = {
    "flights.json": opensky,
    "military.json": adsblol_military,
    "cables.json": cables,
    "conflict.json": gdelt_conflict,
    "ships.json": aisstream_ships,
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.livefeeds", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    status = {}
    with httpx.Client(timeout=45, headers={"User-Agent": UA}, follow_redirects=False) as client:
        for name, fn in FEEDS.items():
            started = time.time()
            try:
                data = fn(client)
                _write(args.out / name, data)
                n = len(data.get("rows") or data.get("cables") or data.get("events") or [])
                status[name] = {"ok": True, "count": n, "time": data["time"]}
                print(f"{name}: {n} items in {time.time() - started:.1f}s")
            except Exception as exc:  # one provider failing must not stop the others
                status[name] = {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:160]}", "time": int(time.time())}
                print(f"{name}: FAILED {type(exc).__name__}: {str(exc)[:160]}", file=sys.stderr)
    _write(args.out / "status.json", status)
    return 0


if __name__ == "__main__":
    sys.exit(main())
