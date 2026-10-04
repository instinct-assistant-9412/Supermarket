"""Load parsed files into Postgres: chains/stores -> chain_items -> products -> prices (+history on change)."""
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..chains import KNOWN_CHAINS
from ..models import Chain, ChainItem, IngestFile, MatchCandidate, PriceCurrent, PriceHistory, Product, Store
from ..normalize.barcode import normalize_gtin
from ..normalize.names import NameIndex, extract_size, normalize_name
from .parse import ParsedFile, ParsedItem, parse_file

log = logging.getLogger("smp.loader")


def _now():
    return datetime.now(timezone.utc)


def _chunks(seq, n=2000):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


class Loader:
    def __init__(self, session: Session):
        self.s = session
        self.index = NameIndex()
        self._index_built = False
        self._chain_cache: dict[str, Chain] = {}

    # ---------- helpers
    def _build_index(self):
        if self._index_built:
            return
        rows = self.s.execute(text(
            "SELECT id, name_norm, manufacturer, size_value, size_unit FROM products WHERE size_value IS NOT NULL")).all()
        for r in rows:
            self.index.add(r.id, r.name_norm, r.manufacturer, r.size_value, r.size_unit)
        self._index_built = True

    def chain(self, chain_id: str, scraper_name: str | None = None) -> Chain:
        c = self._chain_cache.get(chain_id)
        if c:
            return c
        c = self.s.execute(select(Chain).where(Chain.chain_id == chain_id)).scalar_one_or_none()
        if not c:
            c = Chain(chain_id=chain_id, scraper_name=scraper_name, name=KNOWN_CHAINS.get(chain_id, chain_id))
            self.s.add(c)
            self.s.flush()
        self._chain_cache[chain_id] = c
        return c

    def store(self, chain: Chain, store_code: str, sub_chain_id: str | None = None) -> Store:
        st = self.s.execute(select(Store).where(Store.chain_pk == chain.id, Store.store_code == store_code)
                            .order_by(Store.id)).scalars().first()
        if not st:
            st = Store(chain_pk=chain.id, store_code=store_code, sub_chain_id=sub_chain_id or "0")
            self.s.add(st)
            self.s.flush()
        return st

    # ---------- stores file
    def load_stores(self, pf: ParsedFile) -> int:
        chain = self.chain(pf.chain_id)
        n = 0
        for ps in pf.stores:
            st = self.s.execute(select(Store).where(Store.chain_pk == chain.id, Store.store_code == ps.store_code,
                                                    Store.sub_chain_id == ps.sub_chain_id)).scalar_one_or_none()
            if not st:
                st = Store(chain_pk=chain.id, store_code=ps.store_code, sub_chain_id=ps.sub_chain_id)
                self.s.add(st)
            st.name, st.address, st.city, st.zip_code, st.store_type = ps.name, ps.address, ps.city, ps.zip_code, ps.store_type
            st.city_norm = normalize_name(ps.city) or None
            n += 1
        self.s.flush()
        return n

    # ---------- chain items + products
    def _ensure_items(self, chain: Chain, items: list[ParsedItem]) -> dict[str, int]:
        """Return item_code -> chain_items.id, creating + matching new ones."""
        self._build_index()
        codes = [i.item_code for i in items]
        existing = {}
        for part in _chunks(codes, 5000):
            for r in self.s.execute(text("SELECT item_code, id FROM chain_items WHERE chain_pk=:c AND item_code = ANY(:codes)"),
                                    {"c": chain.id, "codes": part}):
                existing[r.item_code] = r.id
        new = [i for i in items if i.item_code not in existing]
        if not new:
            return existing

        prepared = []
        gtins: dict[str, ParsedItem] = {}
        for it in new:
            name_norm = normalize_name(it.name)
            gtin = None if it.is_weighted else normalize_gtin(it.item_code)
            size_v, size_u = extract_size(name_norm, it.quantity, it.unit_of_measure)
            prepared.append((it, name_norm, gtin, size_v, size_u))
            if gtin and gtin not in gtins:
                gtins[gtin] = it

        # canonical products by gtin (create missing)
        prod_by_gtin: dict[str, int] = {}
        if gtins:
            for part in _chunks(list(gtins), 5000):
                for r in self.s.execute(text("SELECT gtin, id FROM products WHERE gtin = ANY(:g)"), {"g": part}):
                    prod_by_gtin[r.gtin] = r.id
            missing = [g for g in gtins if g not in prod_by_gtin]
            for g in missing:
                it = gtins[g]
                nn = normalize_name(it.name)
                sv, su = extract_size(nn, it.quantity, it.unit_of_measure)
                ins = pg_insert(Product).values(gtin=g, name=it.name[:400], name_norm=nn[:400],
                                                manufacturer=(it.manufacturer or None), size_value=sv, size_unit=su)
                pid = self.s.execute(ins.on_conflict_do_nothing(index_elements=["gtin"]).returning(Product.id)).scalar()
                if pid is None:
                    pid = self.s.execute(text("SELECT id FROM products WHERE gtin=:g"), {"g": g}).scalar()
                prod_by_gtin[g] = pid
                self.index.add(pid, nn, it.manufacturer, sv, su)

        rows, candidates = [], []
        for it, nn, gtin, sv, su in prepared:
            product_id, method, conf = None, "none", None
            if gtin:
                product_id, method, conf = prod_by_gtin[gtin], "gtin", 1.0
            elif not it.is_weighted and sv is not None:
                cand, score = self.index.best(nn, it.manufacturer, sv, su)
                if cand and score >= NameIndex.AUTO:
                    product_id, method, conf = cand.product_id, "fuzzy", score
                elif cand and score >= NameIndex.REVIEW:
                    candidates.append((it.item_code, cand.product_id, score))
            rows.append(dict(chain_pk=chain.id, item_code=it.item_code, item_type=it.item_type, product_id=product_id,
                             gtin=gtin, name_raw=it.name[:400], name_norm=nn[:400], manufacturer=(it.manufacturer or None),
                             is_weighted=it.is_weighted, unit_of_measure=it.unit_of_measure, quantity=it.quantity,
                             match_method=method, match_confidence=conf))
        for part in _chunks(rows, 2000):
            stmt = pg_insert(ChainItem).values(part).on_conflict_do_nothing(index_elements=["chain_pk", "item_code"])
            self.s.execute(stmt)
        new_codes = [r["item_code"] for r in rows]
        for part in _chunks(new_codes, 5000):
            for r in self.s.execute(text("SELECT item_code, id FROM chain_items WHERE chain_pk=:c AND item_code = ANY(:codes)"),
                                    {"c": chain.id, "codes": part}):
                existing[r.item_code] = r.id
        for code, pid, score in candidates:
            if code in existing:
                self.s.execute(pg_insert(MatchCandidate).values(chain_item_pk=existing[code], product_id=pid, score=score)
                               .on_conflict_do_nothing())
        return existing

    # ---------- prices
    def load_prices(self, pf: ParsedFile) -> int:
        chain = self.chain(pf.chain_id)
        store = self.store(chain, pf.store_code, pf.sub_chain_id)
        by_code = {}
        for it in pf.items:      # last occurrence wins
            by_code[it.item_code] = it
        items = list(by_code.values())
        ids = self._ensure_items(chain, items)

        cur = {r.chain_item_pk: r for r in self.s.execute(
            text("SELECT chain_item_pk, price, unit_price, price_updated_at FROM prices_current WHERE store_pk=:s"),
            {"s": store.id})}
        now = _now()
        file_time = pf.file_ts or now
        seen_ids, new_cur, hist = [], [], []
        for it in items:
            cid = ids.get(it.item_code)
            if cid is None:
                continue
            seen_ids.append(cid)
            old = cur.get(cid)
            valid_from = it.updated or file_time
            if old is not None:
                if it.updated and old.price_updated_at and it.updated < old.price_updated_at:
                    continue   # stale/out-of-order file
                if float(old.price) == round(it.price, 2) and (old.unit_price is None or it.unit_price is None
                                                               or float(old.unit_price) == round(it.unit_price, 2)):
                    continue   # unchanged: only last_seen is bumped below
            new_cur.append(dict(store_pk=store.id, chain_item_pk=cid, price=it.price, unit_price=it.unit_price,
                                price_updated_at=valid_from, last_seen_at=now))
            hist.append(dict(store_pk=store.id, chain_item_pk=cid, price=it.price, unit_price=it.unit_price,
                             valid_from=valid_from))
        for part in _chunks(new_cur):
            stmt = pg_insert(PriceCurrent).values(part)
            stmt = stmt.on_conflict_do_update(
                index_elements=["store_pk", "chain_item_pk"],
                set_={k: stmt.excluded[k] for k in ("price", "unit_price", "price_updated_at", "last_seen_at")})
            self.s.execute(stmt)
        for part in _chunks(hist):
            self.s.execute(pg_insert(PriceHistory).values(part))
        for part in _chunks(seen_ids, 10000):
            self.s.execute(text("UPDATE prices_current SET last_seen_at=:t WHERE store_pk=:s AND chain_item_pk = ANY(:ids)"),
                           {"t": now, "s": store.id, "ids": part})
        pf._store_pk = store.id  # type: ignore[attr-defined]
        pf._changed = len(new_cur)  # type: ignore[attr-defined]
        return len(items)

    # ---------- file level
    def ingest_file(self, path: Path) -> str:
        """Returns 'ok' | 'skipped' | 'error'. Idempotent (file_name + sha256)."""
        try:
            pf = parse_file(path)
        except Exception as e:  # noqa: BLE001
            log.warning("parse failed %s: %s", path.name, e)
            self._record(None, None, path.name, "unknown", None, "", 0, "error", str(e)[:500])
            return "error"
        if pf.kind not in ("price", "pricefull", "stores") or not pf.chain_id:
            return "skipped"    # promo files: phase 2
        if self.s.execute(text("SELECT 1 FROM ingest_files WHERE file_name=:n AND sha256=:h"),
                          {"n": path.name, "h": pf.sha256}).first():
            return "skipped"
        try:
            with self.s.begin_nested():
                if pf.kind == "stores":
                    n = self.load_stores(pf)
                    store_pk = None
                else:
                    if not pf.store_code:
                        raise ValueError("price file without StoreId")
                    n = self.load_prices(pf)
                    store_pk = getattr(pf, "_store_pk", None)
                chain = self.chain(pf.chain_id)
                self._record(chain.id, store_pk, path.name, pf.kind, pf.file_ts, pf.sha256, n, "ok", None)
            return "ok"
        except Exception as e:  # noqa: BLE001
            log.exception("load failed %s", path.name)
            self._record(self.chain(pf.chain_id).id, None, path.name, pf.kind, pf.file_ts, pf.sha256, 0, "error", str(e)[:500])
            return "error"

    def _record(self, chain_pk, store_pk, name, kind, ts, sha, rows, status, error):
        self.s.execute(pg_insert(IngestFile).values(chain_pk=chain_pk, store_pk=store_pk, file_name=name, file_type=kind,
                                                    file_ts=ts, sha256=sha or "-", row_count=rows, status=status, error=error)
                       .on_conflict_do_nothing())


def ingest_path(session: Session, root: str, commit_every: int = 20) -> dict:
    """Walk a dumps directory. Stores files first (so stores have city before prices arrive)."""
    files = [p for p in Path(root).rglob("*") if p.is_file() and p.suffix.lower() in (".xml", ".gz")
             and "status" not in p.parts]
    files.sort(key=lambda p: (0 if p.name.lower().startswith("store") else 1, p.name))
    loader = Loader(session)
    stats = {"ok": 0, "skipped": 0, "error": 0}
    for i, p in enumerate(files, 1):
        stats[loader.ingest_file(p)] += 1
        if i % commit_every == 0:
            session.commit()
    session.commit()
    return stats
