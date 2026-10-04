from smp.normalize.barcode import check_digit, is_valid_gtin, normalize_gtin, with_check
from smp.normalize.names import NameIndex, extract_size, name_similarity, normalize_name

MILK = with_check("729000000001")


def test_check_digit_known_value():
    # classic GS1 example: 400638133393 -> check digit 1
    assert check_digit("400638133393") == 1
    assert is_valid_gtin("4006381333931")


def test_normalize_pads_to_13_and_rejects_bad():
    assert normalize_gtin(MILK) == MILK
    assert normalize_gtin(" " + MILK[:6] + "-" + MILK[6:] + " ") == MILK       # junk characters
    ean8 = with_check("1234567")
    assert normalize_gtin(ean8) == ean8.zfill(13)
    assert normalize_gtin(MILK[:-1] + str((int(MILK[-1]) + 1) % 10)) is None     # bad check digit


def test_internal_codes_are_not_barcodes():
    assert normalize_gtin("1234") is None
    assert normalize_gtin("0000000099999") is None                                # zero-padded internal code
    assert normalize_gtin(with_check("200000000001")) is None                     # variable-weight prefix 2
    assert normalize_gtin("0000000000000") is None


def test_gtin14_and_gtin12():
    upc = "036000291452"
    assert normalize_gtin(upc) == "0" + upc
    assert normalize_gtin("0" + upc) == "0" + upc                                 # 13-digit zero-padded UPC == same product


def test_names_and_sizes():
    n = normalize_name("חלב תנובה 3% 1 ל'")
    assert extract_size(n) == (1000.0, "ml")
    assert extract_size(normalize_name("קוטג' 250 גרם")) == (250.0, "g")
    assert extract_size(normalize_name("שוקולד 1.5 ק\"ג")) == (1500.0, "g")
    assert extract_size("בלי גודל", 500, "גרם") == (500.0, "g")


def test_name_similarity_orders_sensibly():
    a = normalize_name("קוטג' תנובה 250 גרם")
    assert name_similarity(a, normalize_name("קוטג תנובה 250 גר")) > 0.85
    assert name_similarity(a, normalize_name("יוגורט שטראוס 250 גרם")) < 0.5


def test_name_index_requires_same_size():
    idx = NameIndex()
    idx.add(1, normalize_name("קוטג' תנובה 250 גרם"), "תנובה", 250, "g")
    c, score = idx.best(normalize_name("קוטג תנובה 250 גר"), "תנובה", 250, "g")
    assert c and c.product_id == 1 and score >= NameIndex.AUTO
    assert idx.best(normalize_name("קוטג תנובה 500 גרם"), "תנובה", 500, "g")[0] is None
