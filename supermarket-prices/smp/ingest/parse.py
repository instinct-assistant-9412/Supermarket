"""Parse the standard Israeli price-transparency XML files (PriceFull / Price / Stores).

!! Chain-specific details need live testing !!
All chains implement the same legal spec but differ in tag casing, wrapper tags
(Items/Item vs Products/Product), encodings (utf-8 / windows-1255 / utf-16), gzip, and
date formats. This parser is tolerant: case-insensitive tag names, synonym lists, lxml
recover mode. Add a chain-specific override in `FIELD_SYNONYMS` / `parse_dt` when a chain breaks.
"""
import gzip
import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from lxml import etree

IL_TZ = ZoneInfo("Asia/Jerusalem")

FIELD_SYNONYMS = {
    "item_code": ["itemcode", "itemid"],
    "item_type": ["itemtype"],
    "name": ["itemname", "itemnm", "manufactureritemdescription"],
    "manufacturer": ["manufacturername", "manufacturename"],
    "country": ["manufacturecountry", "manufacturercountry"],
    "unit_qty": ["unitqty"],
    "quantity": ["quantity"],
    "is_weighted": ["bisweighted"],
    "unit_of_measure": ["unitofmeasure"],
    "price": ["itemprice", "price"],
    "unit_price": ["unitofmeasureprice", "unitprice"],
    "updated": ["priceupdatedate", "priceupdatetime", "updatedate"],
    "status": ["itemstatus"],
}
STORE_SYNONYMS = {
    "store_code": ["storeid"],
    "sub_chain_id": ["subchainid"],
    "name": ["storename"],
    "address": ["address"],
    "city": ["city"],
    "zip": ["zipcode"],
    "store_type": ["storetype"],
}

_FILE_RE = re.compile(r"^(?P<kind>pricefull|promofull|price|promo|stores?)[-_]?(?P<chain>\d{6,13})?[-_]?(?P<store>\d{1,4})?[-_]?(?P<ts>\d{8,14})?", re.I)


@dataclass
class ParsedItem:
    item_code: str
    item_type: str | None
    name: str
    manufacturer: str | None
    quantity: float | None
    unit_of_measure: str | None
    is_weighted: bool
    price: float
    unit_price: float | None
    updated: datetime | None


@dataclass
class ParsedStore:
    store_code: str
    sub_chain_id: str
    name: str | None
    address: str | None
    city: str | None
    zip_code: str | None
    store_type: str | None


@dataclass
class ParsedFile:
    kind: str                   # pricefull | price | stores | promo...
    chain_id: str | None
    sub_chain_id: str | None
    store_code: str | None
    file_ts: datetime | None
    items: list[ParsedItem] = field(default_factory=list)
    stores: list[ParsedStore] = field(default_factory=list)
    sha256: str = ""
    skipped_rows: int = 0


def read_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return data


def classify_filename(name: str) -> tuple[str, str | None, str | None, datetime | None]:
    m = _FILE_RE.match(Path(name).name)
    if not m:
        return "unknown", None, None, None
    kind = m.group("kind").lower()
    kind = "stores" if kind.startswith("store") else kind
    ts = None
    if m.group("ts"):
        raw = m.group("ts")
        for fmt in ("%Y%m%d%H%M", "%Y%m%d%H%M%S", "%Y%m%d"):
            try:
                ts = datetime.strptime(raw, fmt).replace(tzinfo=IL_TZ)
                break
            except ValueError:
                continue
    return kind, m.group("chain"), m.group("store"), ts


def parse_dt(text: str | None) -> datetime | None:
    """Dates seen: '2026-10-04 06:00', '2026-10-04 06:00:00', '04/10/2026 06:00', ISO. Source is Israel local time."""
    if not text:
        return None
    text = text.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
                "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=IL_TZ)
        except ValueError:
            continue
    return None


def _num(text: str | None) -> float | None:
    if text is None:
        return None
    t = text.strip().replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def _local(tag) -> str:
    return tag.split("}")[-1].lower() if isinstance(tag, str) else ""


def _children_map(el) -> dict[str, str]:
    return {_local(c.tag): (c.text or "").strip() for c in el if isinstance(c.tag, str)}


def _pick(m: dict[str, str], names: list[str]) -> str | None:
    for n in names:
        if m.get(n):
            return m[n]
    return None


def parse_file(path: Path) -> ParsedFile:
    raw = read_bytes(path)
    sha = hashlib.sha256(raw).hexdigest()
    kind, chain_from_name, store_from_name, ts = classify_filename(path.name)
    parser = etree.XMLParser(recover=True, huge_tree=True, remove_blank_text=True)
    root = etree.fromstring(raw, parser=parser)  # lxml honours the XML declaration encoding
    if root is None:
        raise ValueError(f"cannot parse XML: {path}")

    header = {}
    for el in root.iter():
        n = _local(el.tag)
        if n in ("chainid", "subchainid", "storeid") and el.text and n not in header:
            header[n] = el.text.strip()
    pf = ParsedFile(kind=kind, chain_id=header.get("chainid") or chain_from_name,
                    sub_chain_id=header.get("subchainid"), store_code=(header.get("storeid") or store_from_name),
                    file_ts=ts, sha256=sha)

    if kind == "stores":
        for el in root.iter():
            if _local(el.tag) == "store":
                m = _children_map(el)
                code = _pick(m, STORE_SYNONYMS["store_code"])
                if not code:
                    continue
                pf.stores.append(ParsedStore(
                    store_code=code.lstrip("0") or "0",
                    sub_chain_id=_pick(m, STORE_SYNONYMS["sub_chain_id"]) or pf.sub_chain_id or "0",
                    name=_pick(m, STORE_SYNONYMS["name"]), address=_pick(m, STORE_SYNONYMS["address"]),
                    city=_pick(m, STORE_SYNONYMS["city"]), zip_code=_pick(m, STORE_SYNONYMS["zip"]),
                    store_type=_pick(m, STORE_SYNONYMS["store_type"])))
        return pf

    if kind in ("price", "pricefull"):
        if pf.store_code:
            pf.store_code = pf.store_code.lstrip("0") or "0"
        for el in root.iter():
            if _local(el.tag) not in ("item", "product"):
                continue
            m = _children_map(el)
            code = _pick(m, FIELD_SYNONYMS["item_code"])
            price = _num(_pick(m, FIELD_SYNONYMS["price"]))
            name = _pick(m, FIELD_SYNONYMS["name"])
            if not code or price is None or price <= 0 or not name:
                pf.skipped_rows += 1
                continue
            weighted = (_pick(m, FIELD_SYNONYMS["is_weighted"]) or "0").strip().lower() in ("1", "true", "כן")
            pf.items.append(ParsedItem(
                item_code=code, item_type=_pick(m, FIELD_SYNONYMS["item_type"]), name=name,
                manufacturer=_pick(m, FIELD_SYNONYMS["manufacturer"]),
                quantity=_num(_pick(m, FIELD_SYNONYMS["quantity"])),
                unit_of_measure=_pick(m, FIELD_SYNONYMS["unit_of_measure"]),
                is_weighted=weighted, price=price, unit_price=_num(_pick(m, FIELD_SYNONYMS["unit_price"])),
                updated=parse_dt(_pick(m, FIELD_SYNONYMS["updated"]))))
    return pf
