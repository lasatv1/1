"""API / domain models. Field names are camelCase on the wire to match the frontend
types in frontend/src/types/intel.ts."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Severity = Literal["critical", "high", "medium", "low", "info"]
Category = Literal["malware", "ransomware", "phishing", "botnet", "c2", "breach", "vulnerability", "scanning", "network"]
Basis = Literal["observed_traffic", "infrastructure_geolocation", "attribution_claim", "inferred"]
IndicatorType = Literal["ipv4", "ipv6", "domain", "url", "sha256", "md5", "cve", "asn"]
SourceStatus = Literal["ok", "degraded", "unavailable", "not_configured", "demo"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)


class Indicator(CamelModel):
    type: IndicatorType
    value: str = Field(max_length=2048)


class ThreatEvent(CamelModel):
    """A normalised observation. Provenance fields (source, sourceRecordId and the
    collected/observed/updated timestamps) are mandatory for every record."""

    id: str
    source_id: str
    source_record_id: str
    category: Category
    severity: Severity
    confidence: int = Field(ge=0, le=100)
    observed_at: datetime
    first_seen: datetime
    last_seen: datetime
    collected_at: datetime
    updated_at: datetime
    src_country: str | None = Field(default=None, pattern=r"^[A-Z0-9]{2,3}$")
    dst_country: str | None = Field(default=None, pattern=r"^[A-Z0-9]{2,3}$")
    src_ip: str | None = None
    dst_ip: str | None = None
    src_asn: int | None = None
    dst_asn: int | None = None
    src_org: str | None = None
    indicators: list[Indicator] = []
    basis: Basis
    description: str = Field(max_length=4000)
    references: list[str] = []


class IntelSource(CamelModel):
    id: str
    name: str
    url: str | None
    status: SourceStatus
    status_detail: str | None = None
    last_sync: datetime | None = None
    record_count: int = 0
    attribution_method: str
    categories: list[Category]
    is_demo: bool = False


class CountryNetworkFacts(CamelModel):
    country: str
    asn_count: int | None
    ipv4_prefixes: int | None
    ipv6_prefixes: int | None
    source: str
    observed_at: datetime
    is_demo: bool = False


class EventPage(CamelModel):
    items: list[ThreatEvent]
    next_cursor: str | None
    total: int


class CatalogEntry(CamelModel):
    """Non-geolocated catalogue record (e.g. CISA KEV). Listed, never mapped."""

    id: str
    title: str
    vendor: str | None = None
    product: str | None = None
    date_added: datetime | None = None
    due_date: datetime | None = None
    known_ransomware_use: bool | None = None
    reference: str | None = None


class RelationshipAggregate(CamelModel):
    src: str
    dst: str
    category: Category
    severity: Severity
    count: int
    first_seen: datetime
    last_seen: datetime
    sources: list[str]
    bases: list[Basis]
