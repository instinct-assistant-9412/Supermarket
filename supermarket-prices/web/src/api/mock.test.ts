import { describe, expect, it } from "vitest";
import { createClient } from "./client";
import { mockFetch } from "./mock";

const api = createClient("/mock", mockFetch);

describe("mock API (אותו חוזה כמו ה-API האמיתי)", () => {
  it("חיפוש בעברית מחזיר טווח מחירים", async () => {
    const hits = await api.search("חלב");
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]!.minPrice).not.toBeNull();
  });

  it("היסטוריה לפי מזהה, ו-404 למוצר לא קיים", async () => {
    expect((await api.history(1)).points.length).toBeGreaterThan(5);
    await expect(api.history(9999)).rejects.toThrow("product not found");
  });

  it("סל: הזול ראשון, ואונליין נפרד מפיזי", async () => {
    const physical = await api.basket([{ query: "חלב", qty: 2 }, { query: "ביצים" }], {}, true);
    expect(physical.stores.every((s) => !s.isOnline)).toBe(true);
    const totals = physical.stores.map((s) => s.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    const online = await api.basket([{ query: "חלב" }], { online: true }, true);
    expect(online.stores.every((s) => s.isOnline)).toBe(true);
  });

  it("טריות", async () => {
    const f = await api.freshness();
    expect(f.some((c) => c.status === "stale")).toBe(true);
  });
});
