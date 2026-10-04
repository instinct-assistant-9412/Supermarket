import { describe, expect, it } from "vitest";
import { isValidGtin, normalizeGtin } from "../src/normalize/gtin.js";
import { extractSize, normalizeHebrew, sizesCompatible } from "../src/normalize/hebrew.js";
import { similarity } from "../src/normalize/trigram.js";
import { gtin13 } from "./helpers.js";

describe("gtin", () => {
  it("validates check digits", () => {
    expect(isValidGtin("7290016314779")).toBe(true);
    expect(isValidGtin("7290016314778")).toBe(false);
    expect(isValidGtin("123")).toBe(false);
  });
  it("pads GTIN-8 and UPC-12 to 13 digits so they match EAN-13 form", () => {
    expect(normalizeGtin({ itemCode: "96385074" })).toBe("0000096385074");
    const upc = gtin13("03600029145").slice(0, 12); // 12 digit UPC-A
    expect(normalizeGtin({ itemCode: upc })).toBe("0" + upc);
    expect(normalizeGtin({ itemCode: "0" + upc })).toBe("0" + upc);
  });
  it("rejects chain internal codes, bad check digits and 2xx in-store prefixes", () => {
    expect(normalizeGtin({ itemCode: "7290016314779", itemType: 0 })).toBeNull();
    expect(normalizeGtin({ itemCode: "1234" })).toBeNull();
    expect(normalizeGtin({ itemCode: "7290016314770" })).toBeNull();
    expect(normalizeGtin({ itemCode: gtin13("290000000012") })).toBeNull();
  });
  it("accepts a zero-led GTIN-14 as the same product", () => {
    expect(normalizeGtin({ itemCode: "07290016314779" })).toBe("7290016314779");
  });
});

describe("hebrew normalization", () => {
  it("removes niqqud, quotes and unifies final letters", () => {
    expect(normalizeHebrew("חָלָב תנובה 3%")).toBe("חלב תנובה 3");
    expect(normalizeHebrew('שוקולד  מ"ל')).toBe("שוקולד מל");
  });
  it("unifies unit spellings and splits glued numbers", () => {
    expect(normalizeHebrew("פילה מטיאס 200גרם")).toBe("פילה מטיאס 200 גרמ");
    expect(normalizeHebrew("הרינג 220 גר")).toBe("הרינג 220 גרמ");
    expect(normalizeHebrew("מיץ 1.5 ל")).toBe(normalizeHebrew("מיץ 1.5 ליטר"));
    expect(normalizeHebrew("קפה 100 גר'")).toBe("קפה 100 גרמ");
  });
  it("does not rewrite letters inside words", () => {
    expect(normalizeHebrew("גרגירי חומוס")).toBe("גרגירי חומוס");
  });
  it("extracts sizes in base units", () => {
    expect(extractSize(normalizeHebrew("קמח 1 קג"))).toEqual({ value: 1000, unit: "g" });
    expect(extractSize(normalizeHebrew("מיץ 1.5 ליטר"))).toEqual({ value: 1500, unit: "ml" });
    expect(extractSize(normalizeHebrew("לחם"))).toBeNull();
    expect(sizesCompatible("200g", "250g")).toBe(false);
    expect(sizesCompatible(null, "250g")).toBe(true);
  });
});

describe("trigram similarity", () => {
  it("is 1 for equal text and high for the same product spelled differently", () => {
    expect(similarity("חלב תנובה 3 1 ליטר", "חלב תנובה 3 1 ליטר")).toBe(1);
    const a = normalizeHebrew("חלב תנובה 3% 1 ל'");
    const b = normalizeHebrew('חלב תנובה 3% 1 ליטר');
    expect(similarity(a, b)).toBeGreaterThan(0.8);
  });
  it("is low for different products", () => {
    expect(similarity(normalizeHebrew("חלב תנובה 3% 1 ליטר"), normalizeHebrew("שמפו הד אנד שולדרס"))).toBeLessThan(0.2);
  });
  it("is 0 for empty input", () => {
    expect(similarity("", "abc")).toBe(0);
  });
});
