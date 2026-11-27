"""Normaliser tests against small hand-written payloads shaped like each source's
documented format. Values are fixtures (documentation IPs), not real intelligence."""
from datetime import UTC, datetime

from app.config import Settings
from app.intelligence.adapters.abuseipdb import AbuseIpdbAdapter
from app.intelligence.adapters.cisa_kev import CisaKevAdapter
from app.intelligence.adapters.feodo import FeodoAdapter
from app.intelligence.adapters.otx import OtxAdapter
from app.intelligence.adapters.ripestat import RipeStatAdapter
from app.intelligence.aggregation.relationships import aggregate
from app.intelligence.correlation.countries import iso2_for_name
from app.intelligence.enrichment.geoip import GeoEnricher
from app.intelligence.normalizers.common import country, event_id, parse_ts, public_ip
from app.security import redact
from app.store import MemoryStore

NOW = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)
S = Settings()
GEO = GeoEnricher(None)


class FakeGeo(GeoEnricher):
    def __init__(self, table):
        super().__init__(None)
        self.table = table

    def country(self, ip):
        return self.table.get(ip)


def test_parse_ts_formats():
    assert parse_ts("2026-11-20 10:00:00") == datetime(2026, 11, 20, 10, tzinfo=UTC)
    assert parse_ts("2026-11-20T10:00:00Z") == datetime(2026, 11, 20, 10, tzinfo=UTC)
    assert parse_ts("2026-11-20 10:00:00 UTC") == datetime(2026, 11, 20, 10, tzinfo=UTC)
    assert parse_ts("garbage") is None


def test_validation_helpers():
    assert country("de") == "DE"
    assert country("XX") is None
    assert public_ip("10.0.0.1") is None  # private ranges never mapped
    assert public_ip("not-an-ip") is None
    assert public_ip("8.8.8.8") == "8.8.8.8"
    assert event_id("a", "1") == event_id("a", "1") != event_id("a", "2")


def test_feodo_normalize_preserves_provenance():
    raw = [
        {"ip_address": "8.8.4.4", "port": 443, "status": "online", "hostname": None, "as_number": 15169,
         "as_name": "EXAMPLE-AS", "country": "US", "first_seen": "2026-11-01 08:00:00",
         "last_online": "2026-11-25", "malware": "QakBot"},
        {"ip_address": "192.168.1.1", "port": 80, "country": "DE", "first_seen": "2026-11-01 08:00:00"},
    ]
    batch = FeodoAdapter(S, GEO).normalize(raw, NOW)
    assert batch.skipped == 1
    (e,) = batch.events
    assert e.src_country == "US" and e.dst_country is None
    assert e.category == "c2" and e.severity == "high"
    assert e.basis == "infrastructure_geolocation"
    assert e.source_id == "abusech-feodo" and e.source_record_id == "8.8.4.4:443"
    assert e.collected_at == NOW and e.first_seen.year == 2026
    assert e.references[0].startswith("https://feodotracker.abuse.ch/")


def test_kev_is_catalog_not_map():
    raw = {"catalogVersion": "2026.11.26", "vulnerabilities": [
        {"cveID": "CVE-2026-0001", "vendorProject": "Vendor", "product": "Product", "vulnerabilityName": "Example",
         "dateAdded": "2026-11-20", "dueDate": "2026-12-11", "knownRansomwareCampaignUse": "Known"}]}
    batch = CisaKevAdapter(S, GEO).normalize(raw, NOW)
    assert batch.events == []
    assert batch.catalog and batch.catalog[0].known_ransomware_use is True


def test_abuseipdb_severity_from_score():
    raw = {"data": [{"ipAddress": "1.1.1.1", "countryCode": "AU", "abuseConfidenceScore": 100, "lastReportedAt": "2026-11-25T10:00:00+00:00"}]}
    (e,) = AbuseIpdbAdapter(S, GEO).normalize(raw, NOW).events
    assert e.severity == "high" and e.confidence == 100 and e.src_country == "AU"


def test_otx_correlation_is_labelled_inferred_and_claims_stay_claims():
    pulse = {
        "id": "abc123", "name": "Ransomware campaign", "created": "2026-11-20T00:00:00", "modified": "2026-11-21T00:00:00",
        "tags": ["ransomware"], "targeted_countries": ["Germany", "Atlantis"], "adversary": "Example Group",
        "references": ["https://example.org/report", "http://insecure.example/x"],
        "indicators": [{"indicator": "9.9.9.9", "type": "IPv4", "created": "2026-11-20T01:00:00"},
                       {"indicator": "evil.example", "type": "domain", "created": "2026-11-20T01:00:00"}],
    }
    adapter = OtxAdapter(S, FakeGeo({"9.9.9.9": "CH"}))
    batch = adapter.normalize([pulse], NOW)
    pair = [e for e in batch.events if e.dst_country]
    assert any(e.src_country == "CH" and e.dst_country == "DE" and e.basis == "inferred" for e in pair)
    assert all("third-party claim" in e.description for e in batch.events)
    assert all(not r.startswith("http://") for e in batch.events for r in e.references)
    assert iso2_for_name("Atlantis") is None


def test_store_dedupes_and_keeps_history():
    raw = [{"ip_address": "8.8.4.4", "port": 443, "status": "online", "country": "US",
            "first_seen": "2026-11-20 08:00:00", "last_online": "2026-11-25"}]
    store = MemoryStore(retention_days=3650)
    a = FeodoAdapter(S, GEO)
    assert store.upsert_events(a.normalize(raw, NOW).events) == 1
    later = datetime(2026, 11, 26, 13, tzinfo=UTC)
    raw[0]["last_online"] = "2026-11-26"
    assert store.upsert_events(a.normalize(raw, later).events) == 0
    (e,) = store.all_events()
    assert e.collected_at == NOW  # original collection time preserved
    assert e.last_seen.day == 26


def test_aggregate_relationships():
    pulse = {"id": "p", "name": "phish kit", "created": "2026-11-20T00:00:00", "tags": ["phishing"],
             "targeted_countries": ["France"],
             "indicators": [{"indicator": "9.9.9.9", "type": "IPv4"}, {"indicator": "8.8.8.8", "type": "IPv4"}]}
    events = OtxAdapter(S, FakeGeo({"9.9.9.9": "CH", "8.8.8.8": "CH"})).normalize([pulse], NOW).events
    (rel,) = aggregate(events)
    assert (rel.src, rel.dst, rel.category, rel.count) == ("CH", "FR", "phishing", 2)


def test_ripestat_parse():
    body = {"data": {"stats": [{"asns_ris": 1200, "v4_prefixes_ris": 9000, "v6_prefixes_ris": 3000,
                                "timeline": [{"starttime": "2026-11-25T00:00:00"}]}]}}
    f = RipeStatAdapter.parse_country("NL", body)
    assert f.asn_count == 1200 and f.country == "NL"


def test_redaction():
    assert "abcdef123456789" not in redact("X-OTX-API-KEY: abcdef123456789xyz")
    assert "***" in redact("api_key=abcdefghijklmnop")
