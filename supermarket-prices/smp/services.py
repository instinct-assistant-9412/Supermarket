"""Query layer shared by the REST API and the MCP server (one implementation, two front doors)."""
from sqlalchemy import text
from sqlalchemy.orm import Session

from .normalize.barcode import digits_only, normalize_gtin
from .normalize.names import normalize_name

# stores in "area": by city (phase 1) and/or radius around a point (needs stores.lat/lon from a geocoding job)
_HAVERSINE = ("6371 * 2 * asin(sqrt(power(sin(radians(st.lat - :lat) / 2), 2) + cos(radians(:lat)) * cos(radians(st.lat)) "
              "* power(sin(radians(st.lon - :lon) / 2), 2)))")


def _area_clause(city, lat, lon, radius_km, params) -> str:
    parts = []
    if city:
        params["city"] = normalize_name(city)
        parts.append("st.city_norm = :city")
    if lat is not None and lon is not None and radius_km:
        params.update(lat=lat, lon=lon, radius=radius_km)
        parts.append(f"st.lat IS NOT NULL AND {_HAVERSINE} <= :radius")
    return (" AND " + " AND ".join(parts)) if parts else ""


def _gtin_or_none(g: str) -> str | None:
    return normalize_gtin(g) or (digits_only(g).zfill(13) if digits_only(g) else None)


def search_products(s: Session, q: str, limit: int = 20) -> list[dict]:
    q = q.strip()
    if q.isdigit():
        g = _gtin_or_none(q)
        rows = s.execute(text("SELECT id, gtin, name, manufacturer, size_value, size_unit FROM products WHERE gtin = :g"), {"g": g}).mappings().all()
        return [dict(r) for r in rows]
    toks = normalize_name(q).split()
    if not toks:
        return []
    where = " AND ".join(f"p.name_norm ILIKE :t{i}" for i in range(len(toks)))
    params = {f"t{i}": f"%{t}%" for i, t in enumerate(toks)}
    params.update(q=normalize_name(q), lim=limit)
    rows = s.execute(text(f"""
        SELECT p.id, p.gtin, p.name, p.manufacturer, p.size_value, p.size_unit,
               count(DISTINCT ci.chain_pk) AS chains, min(pc.price) AS min_price
        FROM products p
        LEFT JOIN chain_items ci ON ci.product_id = p.id
        LEFT JOIN prices_current pc ON pc.chain_item_pk = ci.id
        WHERE {where}
        GROUP BY p.id ORDER BY count(DISTINCT ci.chain_pk) DESC, similarity(p.name_norm, :q) DESC LIMIT :lim"""), params).mappings().all()
    return [dict(r) for r in rows]


def product_prices(s: Session, gtin: str, city=None, lat=None, lon=None, radius_km=None, limit=200) -> dict:
    g = _gtin_or_none(gtin)
    params = {"g": g, "lim": limit}
    area = _area_clause(city, lat, lon, radius_km, params)
    prod = s.execute(text("SELECT id, gtin, name, manufacturer, size_value, size_unit FROM products WHERE gtin=:g"), params).mappings().first()
    if not prod:
        return {"product": None, "prices": [], "cheapest_per_chain": []}
    rows = s.execute(text(f"""
        SELECT ch.name AS chain, ch.chain_id, st.id AS store_id, st.name AS store, st.city, st.address,
               pc.price, pc.unit_price, pc.price_updated_at
        FROM prices_current pc
        JOIN chain_items ci ON ci.id = pc.chain_item_pk
        JOIN products p ON p.id = ci.product_id AND p.gtin = :g
        JOIN stores st ON st.id = pc.store_pk
        JOIN chains ch ON ch.id = st.chain_pk
        WHERE true {area}
        ORDER BY pc.price ASC LIMIT :lim"""), params).mappings().all()
    per_chain: dict = {}
    for r in rows:
        per_chain.setdefault(r["chain_id"], r)
    return {"product": dict(prod), "prices": [dict(r) for r in rows], "cheapest_per_chain": [dict(v) for v in per_chain.values()]}


def price_history(s: Session, gtin: str, chain_id: str | None = None, store_id: int | None = None, days: int = 90) -> list[dict]:
    params = {"g": _gtin_or_none(gtin), "d": days}
    extra = ""
    if chain_id:
        extra += " AND ch.chain_id = :chain"
        params["chain"] = chain_id
    if store_id:
        extra += " AND st.id = :store"
        params["store"] = store_id
    rows = s.execute(text(f"""
        SELECT h.valid_from, h.price, h.unit_price, ch.name AS chain, ch.chain_id, st.id AS store_id, st.name AS store, st.city
        FROM price_history h
        JOIN chain_items ci ON ci.id = h.chain_item_pk
        JOIN products p ON p.id = ci.product_id AND p.gtin = :g
        JOIN stores st ON st.id = h.store_pk
        JOIN chains ch ON ch.id = st.chain_pk
        WHERE h.valid_from > now() - make_interval(days => :d) {extra}
        ORDER BY h.valid_from"""), params).mappings().all()
    return [dict(r) for r in rows]


def price_drops(s: Session, days: int = 7, min_pct: float = 10.0, city: str | None = None, gtin: str | None = None, limit: int = 50) -> list[dict]:
    """Price decreases in the last `days` days. NOTE: scans history via LAG; at scale precompute into a table nightly."""
    params = {"d": days, "pct": min_pct, "lim": limit}
    extra = ""
    if city:
        params["city"] = normalize_name(city)
        extra += " AND st.city_norm = :city"
    if gtin:
        params["g"] = _gtin_or_none(gtin)
        extra += " AND p.gtin = :g"
    rows = s.execute(text(f"""
        WITH h AS (
          SELECT store_pk, chain_item_pk, price, valid_from,
                 lag(price) OVER (PARTITION BY store_pk, chain_item_pk ORDER BY valid_from) AS prev_price
          FROM price_history)
        SELECT p.gtin, p.name, ch.name AS chain, st.name AS store, st.city, h.prev_price AS old_price, h.price AS new_price,
               round((h.prev_price - h.price) / h.prev_price * 100, 1) AS drop_pct, h.valid_from
        FROM h
        JOIN chain_items ci ON ci.id = h.chain_item_pk
        JOIN products p ON p.id = ci.product_id
        JOIN stores st ON st.id = h.store_pk
        JOIN chains ch ON ch.id = st.chain_pk
        WHERE h.prev_price > 0 AND h.valid_from > now() - make_interval(days => :d)
          AND (h.prev_price - h.price) / h.prev_price * 100 >= :pct {extra}
        ORDER BY drop_pct DESC LIMIT :lim"""), params).mappings().all()
    return [dict(r) for r in rows]


def cheapest_basket(s: Session, items: list[dict], city=None, lat=None, lon=None, radius_km=None,
                    chain_ids: list[str] | None = None, allow_missing: bool = False, top: int = 5) -> dict:
    """items: [{"gtin": "...", "qty": 2}, ...]. Total per STORE (you shop in one store), ranked cheapest first.
    By default only stores that carry every item are returned; allow_missing=True ranks by coverage first."""
    norm = [(_gtin_or_none(i["gtin"]), float(i.get("qty", 1))) for i in items]
    gtins = [g for g, _ in norm]
    qtys = [q for _, q in norm]
    params = {"gtins": gtins, "qtys": qtys, "n": len(set(gtins)), "top": top}
    area = _area_clause(city, lat, lon, radius_km, params)
    if chain_ids:
        params["chains"] = chain_ids
        area += " AND ch.chain_id = ANY(:chains)"
    having = "" if allow_missing else "HAVING count(*) = :n"
    rows = s.execute(text(f"""
        WITH basket AS (SELECT gtin, sum(qty) AS qty FROM unnest(CAST(:gtins AS text[]), CAST(:qtys AS numeric[])) AS b(gtin, qty) GROUP BY gtin),
        per_store_product AS (
          SELECT st.id AS store_id, p.gtin, min(pc.price) AS price
          FROM prices_current pc
          JOIN chain_items ci ON ci.id = pc.chain_item_pk
          JOIN products p ON p.id = ci.product_id
          JOIN basket b ON b.gtin = p.gtin
          JOIN stores st ON st.id = pc.store_pk
          JOIN chains ch ON ch.id = st.chain_pk
          WHERE true {area}
          GROUP BY st.id, p.gtin)
        SELECT st.id AS store_id, ch.name AS chain, ch.chain_id, st.name AS store, st.city, st.address,
               count(*) AS items_found, sum(sp.price * b.qty) AS total
        FROM per_store_product sp JOIN basket b USING (gtin)
        JOIN stores st ON st.id = sp.store_id JOIN chains ch ON ch.id = st.chain_pk
        GROUP BY st.id, ch.id {having}
        ORDER BY count(*) DESC, sum(sp.price * b.qty) ASC LIMIT :top"""), params).mappings().all()
    results = [dict(r) for r in rows]
    detail = []
    if results:
        best = results[0]["store_id"]
        det = s.execute(text("""
            SELECT p.gtin, p.name, min(pc.price) AS price FROM prices_current pc
            JOIN chain_items ci ON ci.id = pc.chain_item_pk JOIN products p ON p.id = ci.product_id
            WHERE pc.store_pk = :st AND p.gtin = ANY(:g) GROUP BY p.gtin, p.name"""), {"st": best, "g": gtins}).mappings().all()
        detail = [dict(d) for d in det]
    found = {d["gtin"] for d in detail}
    return {"stores": results, "best_store_items": detail, "missing_in_best_store": [g for g in dict.fromkeys(gtins) if g not in found] if results else gtins,
            "note": "Totals use current price per product in a single store. Promotions/loyalty prices are NOT included (phase 2)."}


def list_stores(s: Session, city: str | None = None, chain_id: str | None = None, limit: int = 200) -> list[dict]:
    params, where = {"lim": limit}, "true"
    if city:
        where += " AND st.city_norm = :city"
        params["city"] = normalize_name(city)
    if chain_id:
        where += " AND ch.chain_id = :chain"
        params["chain"] = chain_id
    rows = s.execute(text(f"""SELECT st.id, ch.name AS chain, ch.chain_id, st.name, st.city, st.address FROM stores st
                              JOIN chains ch ON ch.id = st.chain_pk WHERE {where} ORDER BY ch.name, st.city LIMIT :lim"""), params).mappings().all()
    return [dict(r) for r in rows]


def data_freshness(s: Session) -> list[dict]:
    rows = s.execute(text("""
        SELECT DISTINCT ON (q.chain_pk) c.chain_id, coalesce(c.name, c.scraper_name) AS name, q.checked_at, q.ok, q.issues, q.metrics
        FROM quality_reports q JOIN chains c ON c.id = q.chain_pk ORDER BY q.chain_pk, q.checked_at DESC""")).mappings().all()
    return [dict(r) for r in rows]
