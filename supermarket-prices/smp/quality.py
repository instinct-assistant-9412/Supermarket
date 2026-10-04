"""Per-chain freshness / quality checks. Run after every ingest (cron) and expose via API + MCP.

Thresholds are starting points - tune them after a week of real data.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

from .models import QualityReport

STALE_HOURS = 48          # chains must publish at least daily by law; allow slack
MIN_STORE_COVERAGE = 0.6  # share of known stores with a price file in the last STALE_HOURS
MAX_ROWCOUNT_DROP = 0.4   # latest file has >40% fewer rows than the store's median -> suspicious
MIN_GTIN_SHARE = 0.5      # share of non-weighted items with a global barcode


def compute_chain_quality(s: Session, chain_pk: int) -> dict:
    p = {"c": chain_pk, "h": STALE_HOURS}
    m: dict = {}
    r = s.execute(text("""
        SELECT max(file_ts) AS last_ts,
               extract(epoch FROM (now() - max(file_ts)))/3600 AS hours_since
        FROM ingest_files WHERE chain_pk=:c AND status='ok' AND file_type IN ('price','pricefull')"""), p).one()
    m["last_price_file_ts"] = r.last_ts.isoformat() if r.last_ts else None
    m["hours_since_last_file"] = round(float(r.hours_since), 1) if r.hours_since is not None else None

    r = s.execute(text("""
        SELECT (SELECT count(*) FROM stores WHERE chain_pk=:c) AS total,
               (SELECT count(DISTINCT store_pk) FROM ingest_files WHERE chain_pk=:c AND status='ok'
                  AND file_type IN ('price','pricefull') AND file_ts > now() - make_interval(hours => :h)) AS fresh"""), p).one()
    m["stores_total"], m["stores_fresh"] = r.total, r.fresh
    m["store_coverage"] = round(r.fresh / r.total, 3) if r.total else None

    r = s.execute(text("""
        SELECT count(*) AS n, count(*) FILTER (WHERE gtin IS NOT NULL) AS with_gtin
        FROM chain_items WHERE chain_pk=:c AND NOT is_weighted"""), p).one()
    m["items_total"], m["gtin_share"] = r.n, (round(r.with_gtin / r.n, 3) if r.n else None)

    r = s.execute(text("""
        WITH latest AS (
          SELECT DISTINCT ON (store_pk) store_pk, row_count FROM ingest_files
          WHERE chain_pk=:c AND status='ok' AND file_type='pricefull' ORDER BY store_pk, file_ts DESC),
        med AS (
          SELECT store_pk, percentile_cont(0.5) WITHIN GROUP (ORDER BY row_count) AS med FROM ingest_files
          WHERE chain_pk=:c AND status='ok' AND file_type='pricefull' GROUP BY store_pk HAVING count(*) >= 3)
        SELECT count(*) AS n, count(*) FILTER (WHERE l.row_count < med.med * (1 - :drop)) AS shrunk
        FROM latest l JOIN med USING (store_pk)"""), {**p, "drop": MAX_ROWCOUNT_DROP}).one()
    m["stores_with_shrunk_file"], m["stores_compared"] = r.shrunk, r.n

    r = s.execute(text("""
        WITH h AS (
          SELECT h.price, lag(h.price) OVER (PARTITION BY h.store_pk, h.chain_item_pk ORDER BY h.valid_from) AS prev,
                 h.valid_from
          FROM price_history h JOIN chain_items ci ON ci.id = h.chain_item_pk
          WHERE ci.chain_pk=:c AND h.valid_from > now() - interval '7 days')
        SELECT count(*) AS jumps FROM h WHERE prev > 0 AND valid_from > now() - make_interval(hours => :h)
          AND (price / prev >= 5 OR price / prev <= 0.2)"""), p).one()
    m["suspicious_price_jumps"] = r.jumps

    m["errors_recent"] = s.execute(text(
        "SELECT count(*) FROM ingest_files WHERE chain_pk=:c AND status='error' AND ingested_at > now() - make_interval(hours => :h)"), p).scalar()
    return m


def evaluate(m: dict) -> list[str]:
    issues = []
    if m["hours_since_last_file"] is None:
        issues.append("no price files ingested yet")
    elif m["hours_since_last_file"] > STALE_HOURS:
        issues.append(f"stale: last price file {m['hours_since_last_file']}h ago")
    if m["store_coverage"] is not None and m["store_coverage"] < MIN_STORE_COVERAGE:
        issues.append(f"low store coverage: {m['stores_fresh']}/{m['stores_total']} stores fresh")
    if m["stores_compared"] and m["stores_with_shrunk_file"] / m["stores_compared"] > 0.2:
        issues.append(f"{m['stores_with_shrunk_file']} stores published much smaller files than usual")
    if m["gtin_share"] is not None and m["gtin_share"] < MIN_GTIN_SHARE:
        issues.append(f"only {m['gtin_share']:.0%} of items have a global barcode (parser/ItemCode issue?)")
    if m["suspicious_price_jumps"]:
        issues.append(f"{m['suspicious_price_jumps']} price changes >=5x or <=0.2x in the last {STALE_HOURS}h")
    if m["errors_recent"]:
        issues.append(f"{m['errors_recent']} files failed to ingest recently")
    return issues


def run_quality(s: Session, persist: bool = True) -> list[dict]:
    out = []
    for c in s.execute(text("SELECT id, chain_id, name, scraper_name FROM chains ORDER BY id")).all():
        m = compute_chain_quality(s, c.id)
        issues = evaluate(m)
        out.append({"chain_id": c.chain_id, "name": c.name or c.scraper_name, "ok": not issues, "issues": issues, "metrics": m})
        if persist:
            s.add(QualityReport(chain_pk=c.id, ok=not issues, metrics=m, issues=issues))
    if persist:
        s.commit()
    return out
