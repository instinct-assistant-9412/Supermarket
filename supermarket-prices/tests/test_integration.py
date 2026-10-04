"""End-to-end against a real Postgres. Set TEST_DATABASE_URL (a throwaway DB!), e.g.
  TEST_DATABASE_URL=postgresql+psycopg2://smp:smp@localhost:5432/smp_test pytest
"""
import os
import shutil
from pathlib import Path

import pytest
from sqlalchemy import text

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")
SAMPLES = Path(__file__).resolve().parents[1] / "sample_data"


@pytest.fixture(scope="module")
def session():
    from smp.db import get_engine, session_scope
    from smp.models import Base, init_db
    eng = get_engine(URL)
    Base.metadata.drop_all(eng)
    init_db(eng)
    with session_scope() as s:
        yield s


def _ingest(session, tmp_path, names):
    from smp.ingest.loader import ingest_path
    d = tmp_path / "d"
    d.mkdir(exist_ok=True)
    for f in d.iterdir():
        f.unlink()
    for n in names:
        shutil.copy(SAMPLES / n, d / n)
    return ingest_path(session, str(d))


def test_full_flow(session, tmp_path):
    from smp import services
    from smp.normalize.barcode import with_check
    milk = with_check("729000000001")
    day1 = sorted(p.name for p in SAMPLES.glob("*202610040300.xml"))
    assert _ingest(session, tmp_path, day1)["error"] == 0

    # same barcode in two chains -> ONE canonical product, two chain_items
    assert session.execute(text("SELECT count(*) FROM products WHERE gtin=:g"), {"g": milk}).scalar() == 1
    assert session.execute(text("SELECT count(DISTINCT chain_pk) FROM chain_items WHERE gtin=:g"), {"g": milk}).scalar() == 2
    # internal / weighted codes are not matched by code
    assert session.execute(text("SELECT count(*) FROM chain_items WHERE gtin IS NULL AND match_method='none'")).scalar() >= 3
    # barcode-less cottage cheese fuzzy-linked to the barcoded one
    r = session.execute(text("SELECT match_method, product_id FROM chain_items WHERE item_code='77001'")).one()
    assert r.match_method == "fuzzy" and r.product_id is not None

    res = services.product_prices(session, milk, city="ראש העין")
    assert res["cheapest_per_chain"][0]["chain"] is not None and len(res["prices"]) == 2

    basket = services.cheapest_basket(session, [{"gtin": milk, "qty": 2}], city="ראש העין")
    assert basket["stores"][0]["total"] is not None

    # re-ingest is idempotent
    assert _ingest(session, tmp_path, day1)["ok"] == 0

    # day 2: one price drops -> history + price drop
    assert _ingest(session, tmp_path, sorted(p.name for p in SAMPLES.glob("*202610050300.xml")))["error"] == 0
    hist = services.price_history(session, milk, days=3650)
    assert len(hist) >= 4   # 3 initial store prices + at least 1 change
    drops = services.price_drops(session, days=3650, min_pct=10)
    assert any(float(d["new_price"]) == 5.2 for d in drops)

    from smp.quality import run_quality
    assert len(run_quality(session)) == 2
