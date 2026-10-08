/** Digits only. */
export function digitsOnly(code: string): string {
  return code.replace(/\D+/g, "");
}

/** GS1 check digit validation for GTIN-8/12/13/14. */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += (digits[i] as number) * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

export interface GtinInput {
  itemCode: string;
  itemType?: number | null;
  isWeighted?: boolean;
}

/**
 * Returns the canonical 13-digit GTIN (zero padded, so GTIN-8/12 and EAN-13 compare equal),
 * or null when the code is not a usable global barcode:
 *  - chain internal codes (ItemType 0, wrong length, failed check digit)
 *  - restricted-circulation prefixes (2xx: in-store / price- or weight-embedded barcodes)
 */
export function normalizeGtin(input: GtinInput): string | null {
  if (input.itemType === 0) return null;
  let code = digitsOnly(input.itemCode.trim());
  if (code.length === 14 && code.startsWith("0")) code = code.slice(1);
  if (![8, 12, 13].includes(code.length)) return null;
  if (!isValidGtin(code)) return null;
  const padded = code.padStart(13, "0");
  if (padded.startsWith("2")) return null;
  return padded;
}
