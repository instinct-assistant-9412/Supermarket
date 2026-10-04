"""Hebrew product-name normalization + size extraction + fuzzy matching.

Used ONLY for items without a valid global barcode (stage 2). Barcode match always wins.
"""
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

_NIKUD = re.compile(r"[\u0591-\u05C7]")
_QUOTES = re.compile(r"[\"'`׳״]")               # removed: ק"ג -> קג, ל' -> ל, קוטג' -> קוטג
_DOT = re.compile(r"(?<!\d)[.,]|[.,](?!\d)")       # keep decimal points (1.5), drop other dots/commas
_PUNCT = re.compile(r"[()\[\]{}:;!?*+/\\|_~^%-]")
_SPACE = re.compile(r"\s+")

# number + unit, units in the spellings Israeli price files actually use (extend after live testing)
_UNIT_MAP = {
    "גרם": ("g", 1), "גר": ("g", 1), "ג": ("g", 1), "גרמים": ("g", 1), "gr": ("g", 1), "g": ("g", 1),
    "קג": ("g", 1000), "קילו": ("g", 1000), "קילוגרם": ("g", 1000), "kg": ("g", 1000),
    "מל": ("ml", 1), "מיליליטר": ("ml", 1), "ml": ("ml", 1),
    "ליטר": ("ml", 1000), "ל": ("ml", 1000), "לטר": ("ml", 1000), "l": ("ml", 1000),
    "יח": ("unit", 1), "יחידות": ("unit", 1), "יחידה": ("unit", 1), "יחי": ("unit", 1),
}
_SIZE_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(" + "|".join(sorted(map(re.escape, _UNIT_MAP), key=len, reverse=True)) + r")(?![א-תa-z])")

_STOP = {"של", "עם", "ללא", "טעם", "חדש", "מבצע"}


def normalize_name(name: str | None) -> str:
    s = unicodedata.normalize("NFKC", name or "")
    s = _NIKUD.sub("", s).lower()
    s = _QUOTES.sub("", s)
    s = _DOT.sub(" ", s)
    s = _PUNCT.sub(" ", s)
    return _SPACE.sub(" ", s).strip()


def extract_size(name_norm: str, quantity: float | None = None, unit_of_measure: str | None = None):
    """Return (value, unit) in base units (g / ml / unit) or (None, None)."""
    m = _SIZE_RE.search(name_norm)
    if m:
        val = float(m.group(1).replace(",", "."))
        unit, mult = _UNIT_MAP[m.group(2)]
        return round(val * mult, 3), unit
    if quantity and unit_of_measure:
        u = normalize_name(unit_of_measure)
        if u in _UNIT_MAP:
            unit, mult = _UNIT_MAP[u]
            return round(float(quantity) * mult, 3), unit
    return None, None


def strip_size(name_norm: str) -> str:
    return _SPACE.sub(" ", _SIZE_RE.sub(" ", name_norm)).strip()


def name_tokens(name_norm: str) -> list[str]:
    return sorted(t for t in strip_size(name_norm).split() if t not in _STOP)


def name_similarity(a_norm: str, b_norm: str) -> float:
    ta, tb = name_tokens(a_norm), name_tokens(b_norm)
    if not ta or not tb:
        return 0.0
    sa, sb = set(ta), set(tb)
    jacc = len(sa & sb) / len(sa | sb)
    seq = SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio()
    return round(0.5 * jacc + 0.5 * seq, 3)


def manufacturer_match(a: str | None, b: str | None) -> float | None:
    """1.0 same, 0.0 different, None unknown (either missing)."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb or na in ("לא ידוע", "unknown") or nb in ("לא ידוע", "unknown"):
        return None
    if na == nb:
        return 1.0
    return 1.0 if (na in nb or nb in na) else 0.0


@dataclass
class Candidate:
    product_id: int
    name_norm: str
    manufacturer: str | None


class NameIndex:
    """In-memory index of canonical products bucketed by (unit, size). Rebuild per ingest run."""

    AUTO = 0.93      # auto-link at/above (requires same size, manufacturer not contradicting)
    REVIEW = 0.80    # queue for review at/above

    def __init__(self):
        self._b: dict[tuple, list[Candidate]] = {}

    def add(self, product_id, name_norm, manufacturer, size_value, size_unit):
        if size_value is None:
            return
        self._b.setdefault((size_unit, float(size_value)), []).append(Candidate(product_id, name_norm, manufacturer))

    def best(self, name_norm, manufacturer, size_value, size_unit):
        """Return (candidate, score) or (None, 0). Requires known, identical size."""
        if size_value is None:
            return None, 0.0
        best, best_score = None, 0.0
        for c in self._b.get((size_unit, float(size_value)), []):
            score = name_similarity(name_norm, c.name_norm)
            mm = manufacturer_match(manufacturer, c.manufacturer)
            if mm == 0.0:
                score *= 0.7   # different manufacturer: very unlikely to be the same product
            elif mm == 1.0:
                score = min(1.0, score + 0.05)
            if score > best_score:
                best, best_score = c, score
        return best, round(best_score, 3)
