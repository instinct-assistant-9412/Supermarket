import { describe, expect, it } from "vitest";
import type { HistoryPoint } from "./api/types";
import { buildChainSeries, currentPrices, formatAge } from "./format";
import { parseHash } from "./router";

const pt = (chainId: string, storeKey: string, price: number, day: number): HistoryPoint => ({ chainId, storeKey, price, validFrom: new Date(Date.UTC(2026, 9, day)).toISOString() });

describe("format", () => {
  it("המחיר הנוכחי הוא הנקודה האחרונה של כל סניף", () => {
    const cur = currentPrices([pt("a", "1", 10, 1), pt("a", "1", 8, 5), pt("a", "2", 9, 2)]);
    expect(cur.find((c) => c.storeKey === "1")?.price).toBe(8);
    expect(cur).toHaveLength(2);
  });

  it("סדרת רשת = הזול בין הסניפים, עם ערך נישא קדימה", () => {
    const [s] = buildChainSeries([pt("a", "1", 10, 1), pt("a", "2", 12, 2), pt("a", "1", 13, 5)]);
    expect(s!.points.map((p) => p.price)).toEqual([10, 12]); // 10 -> (1:10, 2:12 => min 10 לא משתנה) -> (1:13, 2:12 => 12)
  });

  it("מסנן סניפים לפי keep", () => {
    const out = buildChainSeries([pt("a", "1", 10, 1), pt("a", "9", 5, 1)], (p) => p.storeKey !== "9");
    expect(out[0]!.points[0]!.price).toBe(10);
  });

  it("גיל נתונים בעברית", () => {
    expect(formatAge(null)).toBe("אין נתונים");
    expect(formatAge(7)).toBe("לפני 7 שעות");
    expect(formatAge(72)).toBe("לפני 3 ימים");
  });

  it("ניתוב לפי hash", () => {
    expect(parseHash("#/product/12")).toEqual({ name: "product", ref: "12" });
    expect(parseHash("#/basket")).toEqual({ name: "basket" });
    expect(parseHash("")).toEqual({ name: "search" });
  });
});
