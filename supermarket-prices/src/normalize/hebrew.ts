const NIQQUD = /[\u0591-\u05C7]/g;
const FINAL: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const QUOTES = /["'`´׳״“”‘’]/g;

/** Units mapped to one canonical spelling (after quotes were removed). */
const B = "(?<![א-תa-z0-9])";
const E = "(?![א-תa-z0-9])";
const unitRe = (alts: string) => new RegExp(`${B}(?:${alts})${E}`, "g");
const UNIT_ALIASES: Array<[RegExp, string]> = [
  [unitRe("קג|קילוגרם|קילו"), "קג"],
  [unitRe("גרם|גר|גרמים"), "גרם"],
  [unitRe("ליטר|ל|ליטרים|ליט"), "ליטר"],
  [unitRe("מל|מיליליטר|מיל"), "מל"],
  [unitRe("יח|יחידות|יחידה|יחי"), "יח"],
];

export function normalizeHebrew(input: string): string {
  let s = input.normalize("NFKC");
  s = s.replace(NIQQUD, "");
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)); // Arabic-Indic digits
  s = s.replace(QUOTES, "");
  s = s.toLowerCase();
  s = s.replace(/(\d)[.,](\d)/g, "$1\u0001$2"); // keep decimals such as 1.5
  s = s.replace(/[\-–—_/\\|,;:.()\[\]{}+*&%!?#@~<>=]/g, " ");
  // "200גרם" -> "200 גרם", "גרם200" -> "גרם 200"
  s = s.replace(/(\d)([א-תa-z])/g, "$1 $2").replace(/([א-תa-z])(\d)/g, "$1 $2");
  s = s.replace(/\s+/g, " ").trim();
  for (const [re, canon] of UNIT_ALIASES) s = s.replace(re, canon);
  // final letters are folded last, so the unit words above could be matched in their normal spelling
  s = s.replace(/[ךםןףץ]/g, (c) => FINAL[c] ?? c);
  return s.replace(/\u0001/g, ".");
}

export function tokens(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

export interface SizeKey {
  value: number;
  /** canonical base unit: g, ml or unit */
  unit: "g" | "ml" | "unit";
}

/**
 * Pulls "200 גרם", "1.5 ליטר", "2 קג" out of a normalized name and converts to g / ml.
 * Returns null when no size can be read.
 */
export function extractSize(normalized: string): SizeKey | null {
  const m = normalized.match(/(\d+(?:\.\d+)?)\s*(קג|גרמ|ליטר|מל|יח)(?![א-תa-z0-9])/);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]) {
    case "קג":
      return { value: v * 1000, unit: "g" };
    case "גרמ":
      return { value: v, unit: "g" };
    case "ליטר":
      return { value: v * 1000, unit: "ml" };
    case "מל":
      return { value: v, unit: "ml" };
    default:
      return { value: v, unit: "unit" };
  }
}

export function sizeKeyString(s: SizeKey | null): string | null {
  return s ? `${s.value}${s.unit}` : null;
}

/** Two sizes conflict only when both are known and differ. */
export function sizesCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a === b;
}
