"""Country-name → ISO 3166-1 alpha-2 resolution for feeds that report names (e.g. OTX
"targeted_countries"). Built from mledoze/countries + Natural Earth names
(see frontend/scripts and README); unknown names resolve to None rather than guessing."""
from __future__ import annotations

import json
import unicodedata
from functools import lru_cache
from pathlib import Path


@lru_cache
def _names() -> dict[str, str]:
    return json.loads((Path(__file__).parent / "country_names.json").read_text(encoding="utf-8"))


def iso2_for_name(name: str | None) -> str | None:
    if not name:
        return None
    key = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().strip().lower()
    return _names().get(key)
