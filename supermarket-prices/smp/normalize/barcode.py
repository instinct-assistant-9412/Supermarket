"""Barcode (GTIN) normalization - the heart of cross-chain matching.

Rules (verified against the GS1 check-digit algorithm; chain behaviour needs live testing):
  * keep digits only
  * a *global* barcode = raw length in {8,12,13,14}, valid GS1 check digit,
    >= 7 significant digits after stripping leading zeros (chains often zero-pad
    their internal codes to 13 digits - those must NOT be treated as global),
    and not an in-store/variable-weight prefix (13 digits starting with 2).
  * everything else = chain-local code. Never match those across chains by code.
  * canonical form: 13 digits (GTIN-8/12 zero-padded), 14 only if it does not start with 0.
"""
import re

_DIGITS = re.compile(r"\D+")


def digits_only(raw: str | None) -> str:
    return _DIGITS.sub("", raw or "")


def check_digit(body: str) -> int:
    """GS1 check digit for a digit string WITHOUT its check digit."""
    total = 0
    for i, ch in enumerate(reversed(body)):
        total += int(ch) * (3 if i % 2 == 0 else 1)
    return (10 - total % 10) % 10


def is_valid_gtin(code: str) -> bool:
    if not code.isdigit() or len(code) not in (8, 12, 13, 14):
        return False
    return check_digit(code[:-1]) == int(code[-1])


def normalize_gtin(raw: str | None) -> str | None:
    """Return canonical GTIN string, or None if `raw` is not a global barcode."""
    d = digits_only(raw)
    if len(d) not in (8, 12, 13, 14):
        return None
    if len(d.lstrip("0")) < 7:
        return None
    if len(d) == 13 and d[0] == "2":  # restricted circulation / variable weight
        return None
    if len(d) == 12 and d[0] == "2":
        return None
    if len(set(d)) == 1:
        return None
    if not is_valid_gtin(d):
        return None
    if len(d) == 14:
        return d[1:] if d[0] == "0" else d
    return d.zfill(13)


def with_check(body: str) -> str:
    """Helper for tests / fixtures."""
    return body + str(check_digit(body))
