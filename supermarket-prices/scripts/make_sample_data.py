"""Generate small sample price files (same XML shape as the real ones) into ./sample_data.
Two chains, a shared barcode with different names, an internal code, a weighted item and a
barcode-less item that should fuzzy-match. Day 2 changes two prices (drives history/price-drop demo)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from smp.normalize.barcode import with_check  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "sample_data"
MILK = with_check("729000000001")
COTTAGE = with_check("729000000002")
COLA = with_check("729000000003")
CHAINS = {"7290027600007": ("שופרסל", "שופרסל דיל"), "7290058140886": ("רמי לוי", "רמי לוי")}


def item(code, name, price, mfr="", qty="1", uom="יחידה", weighted=0, updated="2026-10-04 06:00"):
    return f"""<Item><PriceUpdateDate>{updated}</PriceUpdateDate><ItemCode>{code}</ItemCode><ItemType>1</ItemType>
<ItemName>{name}</ItemName><ManufacturerName>{mfr}</ManufacturerName><UnitQty>{uom}</UnitQty><Quantity>{qty}</Quantity>
<bIsWeighted>{weighted}</bIsWeighted><UnitOfMeasure>{uom}</UnitOfMeasure><ItemPrice>{price}</ItemPrice>
<UnitOfMeasurePrice>{price}</UnitOfMeasurePrice><ItemStatus>1</ItemStatus></Item>"""


def price_file(chain, store, items, stamp):
    body = "\n".join(items)
    p = OUT / f"PriceFull{chain}-{store}-{stamp}.xml"
    p.write_text(f"""<?xml version="1.0" encoding="utf-8"?>
<Root><ChainId>{chain}</ChainId><SubChainId>1</SubChainId><StoreId>{int(store)}</StoreId><BikoretNo>1</BikoretNo>
<Items Count="{len(items)}">{body}</Items></Root>""", encoding="utf-8")


def stores_file(chain, stores, stamp):
    rows = "".join(f"<Store><StoreId>{sid}</StoreId><SubChainId>1</SubChainId><StoreName>{n}</StoreName><Address>{a}</Address><City>{c}</City><ZipCode>0</ZipCode><StoreType>1</StoreType></Store>" for sid, n, a, c in stores)
    (OUT / f"Stores{chain}-000-{stamp}.xml").write_text(
        f'<?xml version="1.0" encoding="utf-8"?><Root><ChainId>{chain}</ChainId><SubChains><SubChain><SubChainId>1</SubChainId><Stores>{rows}</Stores></SubChain></SubChains></Root>', encoding="utf-8")


def main():
    OUT.mkdir(exist_ok=True)
    s1, s2 = "7290027600007", "7290058140886"
    stores_file(s1, [(1, "שופרסל דיל ראש העין", "הנחל 1", "ראש העין"), (2, "שופרסל דיל פתח תקווה", "ז'בוטינסקי 5", "פתח תקווה")], "202610040300")
    stores_file(s2, [(1, "רמי לוי ראש העין", "המלאכה 3", "ראש העין")], "202610040300")
    for day, (stamp, d) in enumerate([("202610040300", "2026-10-04 03:00"), ("202610050300", "2026-10-05 03:00")]):
        milk1, milk2 = (6.9, 6.5) if day == 0 else (6.9, 5.2)   # day 2: Rami Levy drops
        price_file(s1, "001", [
            item(MILK, "חלב תנובה 3% 1 ליטר", milk1, "תנובה", "1", "ליטר", updated=d),
            item(COTTAGE, "קוטג' תנובה 250 גרם", 5.9, "תנובה", "250", "גרם", updated=d),
            item("1234", "לחם אחיד פרוס", 7.5, "", updated=d),
            item("5001", "עגבניות", 8.9, "", "1", 'ק"ג', weighted=1, updated=d)], stamp)
        price_file(s1, "002", [item(MILK, "חלב תנובה 3% 1 ליטר", 7.2, "תנובה", "1", "ליטר", updated=d),
                               item(COTTAGE, "קוטג' תנובה 250 גרם", 6.2, "תנובה", "250", "גרם", updated=d)], stamp)
        price_file(s2, "001", [
            item(MILK, "תנובה חלב 3% בקבוק 1 ל'", milk2, "תנובה בע\"מ", "1", "ליטר", updated=d),
            item("0000000099999", "חלב תנובה 3% 1 ליטר אריזה", 5.5, "תנובה", "1", "ליטר", updated=d),  # padded internal code, NOT a barcode
            item("77001", "קוטג תנובה 250 גר", 5.7, "תנובה", "250", "גרם", updated=d),                  # no barcode -> fuzzy
            item(COLA, "קולה 1.5 ליטר", 6.0, "", "1.5", "ליטר", updated=d)], stamp)


if __name__ == "__main__":
    main()
