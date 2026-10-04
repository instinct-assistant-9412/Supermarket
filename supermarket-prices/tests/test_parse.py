from pathlib import Path

from smp.ingest.parse import classify_filename, parse_file

SAMPLES = Path(__file__).resolve().parents[1] / "sample_data"


def test_classify_filename():
    kind, chain, store, ts = classify_filename("PriceFull7290027600007-001-202610040300.xml")
    assert (kind, chain, store) == ("pricefull", "7290027600007", "001") and ts.year == 2026
    assert classify_filename("Stores7290027600007-000-202610040300.xml")[0] == "stores"


def test_parse_price_file():
    pf = parse_file(SAMPLES / "PriceFull7290027600007-001-202610040300.xml")
    assert pf.chain_id == "7290027600007" and pf.store_code == "1"
    assert len(pf.items) == 4
    tomato = [i for i in pf.items if i.item_code == "5001"][0]
    assert tomato.is_weighted and tomato.price == 8.9 and tomato.updated.hour == 3


def test_parse_stores_file():
    pf = parse_file(SAMPLES / "Stores7290027600007-000-202610040300.xml")
    assert [s.city for s in pf.stores] == ["ראש העין", "פתח תקווה"]
