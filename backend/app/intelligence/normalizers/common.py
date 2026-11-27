"""Shared normalisation helpers: timestamps, IDs, category/severity mapping, validation."""
from __future__ import annotations

import hashlib
import ipaddress
import re
from datetime import UTC, datetime

from ...models import Category, Severity

_ISO2 = re.compile(r"^[A-Z]{2}$")


def parse_ts(value: str | None) -> datetime | None:
    """Parses the timestamp formats used by the supported feeds into aware UTC datetimes."""
    if not value:
        return None
    v = value.strip().replace(" UTC", "").replace("Z", "+00:00")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=UTC)
        except ValueError:
            pass
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def event_id(source_id: str, record_id: str) -> str:
    """Stable, opaque event ID derived from provenance (same record → same ID)."""
    digest = hashlib.sha256(f"{source_id}:{record_id}".encode()).hexdigest()[:16].upper()
    return f"EVT-{digest}"


def country(code: str | None) -> str | None:
    if not code:
        return None
    c = code.strip().upper()
    return c if _ISO2.match(c) and c not in {"XX", "ZZ", "EU", "AP"} else None


def public_ip(value: str | None) -> str | None:
    """Returns the IP if it is a valid, globally routable address; otherwise None."""
    if not value:
        return None
    try:
        ip = ipaddress.ip_address(value.strip())
    except ValueError:
        return None
    return str(ip) if ip.is_global else None


_TAG_CATEGORY: list[tuple[tuple[str, ...], Category]] = [
    (("ransom",), "ransomware"),
    (("phish", "credential"), "phishing"),
    (("c2", "c&c", "command and control", "cobalt", "beacon"), "c2"),
    (("botnet", "mirai", "bot"), "botnet"),
    (("scan", "brute", "bruteforce", "ssh"), "scanning"),
    (("cve-", "exploit", "vulnerab"), "vulnerability"),
    (("breach", "leak"), "breach"),
]


def category_from_tags(tags: list[str], default: Category = "malware") -> Category:
    text = " ".join(t.lower() for t in tags)
    for needles, cat in _TAG_CATEGORY:
        if any(n in text for n in needles):
            return cat
    return default


def severity_from_score(score: float) -> Severity:
    """Maps a 0–100 confidence/abuse score to severity (documented, not tuned for effect)."""
    if score >= 95:
        return "high"
    if score >= 75:
        return "medium"
    if score >= 40:
        return "low"
    return "info"


def now() -> datetime:
    return datetime.now(UTC)
