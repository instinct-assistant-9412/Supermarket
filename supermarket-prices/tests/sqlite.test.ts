import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { loadConfig } from "../src/config.js";
import { openStorage, type Storage } from "../src/db/storage.js";
import { ingestSource } from "../src/ingest/ingest.js";
import { PriceService } from "../src/service.js";
import { MockSource, gtin13, priceXml, storesXml } from "./helpers.js";

const MILK = gtin13("729001000001");
const RICE = gtin13("729001000002");
const t1 = new Date("2026-10-04T06:00:00Z");
const config = loadConfig({});
const opts = { config, now: () => new Date("2026-10-04T08:00:00Z") };

const open: Storage[] = [];
async function mem() {
  const s = await openStorage({ dbDriver: "sqlite", databaseUrl: "", sqlitePath: ":memory:" });
  open.push(s);
  return s;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

function sources() {
  const a = new MockSource("chain-a", "רשת א");
  a.add("Stores111-000-20261004-0500.xml", "stores", "111", "000", null, t1, storesXml("111", [
    { sub: "1", id: "1", name: "סניף מרכז", city: "ראש העין", address: "הרצל 1" },
    { sub: "1", id: "9", name: "אונליין", city: "", address: "", type: 2 },
  ]));
  a.add("PriceFull111-001-001-20261004-0600.gz", "pricefull", "111", "1", "1", t1, priceXml("111", "1", "1", [
    { code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 6.9 },
    { code: RICE, name: "אורז בסמטי סוגת 1 קג", price: 12.9 },
    { code: "5001", name: "עגבניות שרי אורגניות 500 גרם", price: 14.9, type: 0 },
  ]));
  a.add("PriceFull111-001-009-20261004-0600.gz", "pricefull", "111", "1", "9", t1, priceXml("111", "1", "9", [{ code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 7.9 }]));
  const b = new MockSource("chain-b", "רשת ב");
  b.add("Stores222-000-20261004-0500.xml", "stores", "222", "000", null, t1, storesXml("222", [
    { sub: "1", id: "7", name: "סניף צפון", city: "ראש העין", address: "סירקין 3" },
    { sub: "1", id: "8", name: "סניף רחוק", city: "אילת", address: "התמרים 2" },
  ]));
  b.add("PriceFull222-001-007-20261004-0600.gz", "pricefull", "222", "1", "7", t1, priceXml("222", "1", "7", [
    { code: MILK, name: "חלב תנובה 3 אחוז 1 ל'", price: 6.5 },
    { code: RICE, name: "אורז בסמטי סוגת 1 קילו", price: 13.5 },
    { code: "77", name: "עגבניות שרי אורגניות 500 גר", price: 12.9, type: 0 },
  ]));
  b.add("PriceFull222-001-008-20261004-0600.gz", "pricefull", "222", "1", "8", t1, priceXml("222", "1", "8", [{ code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 5.9 }]));
  return { a, b };
}

describe("SQLite (מצב מקומי, בלי Postgres)", () => {
  it("בחירת הדרייבר לפי הגדרות", () => {
    expect(loadConfig({}).dbDriver).toBe("sqlite");
    expect(loadConfig({ DATABASE_URL: "postgres://x" }).dbDriver).toBe("pg");
    expect(loadConfig({ DATABASE_URL: "postgres://x", DB_DRIVER: "sqlite" }).dbDriver).toBe("sqlite");
    expect(() => loadConfig({ DB_DRIVER: "mysql" })).toThrow();
  });

  it("קולט שתי רשתות, מתאים לפי ברקוד ולפי שם, ועונה על סל, חיפוש והיסטוריה", async () => {
    const { repo } = await mem();
    const { a, b } = sources();
    const sa = await ingestSource(repo, a, opts);
    const sb = await ingestSource(repo, b, opts);
    expect(sa.failures).toEqual([]);
    expect(sb.failures).toEqual([]);
    // אותו ברקוד -> מוצר אחד; עגבניות עם קוד פנימי הותאמו לפי שם בין רשתות
    const tomato = (await repo.searchProducts("עגבניות שרי", 10)).filter((p) => p.nameNorm.includes("עגבניות שרי"));
    expect(tomato).toHaveLength(1);
    expect(tomato[0]!.chains).toBe(2);
    expect((await repo.getChainItem("222", "77"))?.matchMethod).toBe("fuzzy");
    // קליטה חוזרת מדלגת על קבצים שכבר נקלטו
    expect((await ingestSource(repo, a, opts)).filesIngested).toBe(0);

    const service = new PriceService(repo);
    const basket = await service.cheapestBasket([{ gtin: MILK, qty: 2 }, { query: "אורז בסמטי" }], { text: "ראש העין" });
    expect(basket.complete).toBe(true);
    expect(basket.stores[0]).toMatchObject({ chainId: "222", total: 26.5 });
    expect(basket.stores[1]).toMatchObject({ chainId: "111", total: 26.7 });
    expect(basket.stores.some((s) => s.city === "אילת")).toBe(false);
    // אונליין ופיזי לא מתערבבים
    const online = await service.cheapestBasket([{ gtin: MILK }], { online: true });
    expect(online.stores.map((s) => s.total)).toEqual([7.9]);
    expect(online.stores[0]!.isOnline).toBe(true);
  });

  it("חיפוש מטושטש בעברית (בלי pg_trgm) מוצא לפי כתיב חלקי", async () => {
    const { repo } = await mem();
    const { a, b } = sources();
    await ingestSource(repo, a, opts);
    await ingestSource(repo, b, opts);
    const hits = await repo.searchProducts("חלב תנובה", 5);
    expect(hits[0]!.minPrice).toBe(5.9);
    expect(hits[0]!.chains).toBe(2);
    expect((await repo.searchProducts("אורז בסמתי", 5))[0]!.name).toContain("אורז");
    expect(await repo.searchProducts("zzzzzz", 5)).toEqual([]);
  });

  it("היסטוריה נשמרת רק בשינוי מחיר", async () => {
    const { repo } = await mem();
    const { a } = sources();
    await ingestSource(repo, a, opts);
    a.add("PriceFull111-001-001-20261005-0600.gz", "pricefull", "111", "1", "1", new Date("2026-10-05T06:00:00Z"), priceXml("111", "1", "1", [
      { code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 7.2 },
      { code: RICE, name: "אורז בסמטי סוגת 1 קג", price: 12.9 },
      { code: "5001", name: "עגבניות שרי אורגניות 500 גרם", price: 14.9, type: 0 },
    ]));
    const sum = await ingestSource(repo, a, opts);
    expect(sum.runs[0]!.priceChanges).toBe(1);
    const h = await new PriceService(repo).priceHistory({ gtin: MILK }, {});
    expect(h!.points.filter((p) => p.storeKey === "1").map((p) => p.price)).toEqual([6.9, 7.2]);
    expect(h!.points[0]!.validFrom).toBeInstanceOf(Date);
  });

  it("טריות, חנויות ותור בדיקה", async () => {
    const { repo } = await mem();
    const { a } = sources();
    await ingestSource(repo, a, opts);
    const f = await repo.freshness();
    expect(f[0]).toMatchObject({ chainId: "111", stores: 2 });
    expect(f[0]!.lastFileTime).toBeInstanceOf(Date);
    expect((await repo.listStores({ online: true, limit: 10 })).map((s) => s.storeName)).toEqual(["אונליין"]);
    expect(await repo.reviewQueue(10)).toEqual([]);
  });

  it("הנתונים נשמרים בקובץ בין הרצות (כולל אינדקס החיפוש)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prices-"));
    try {
      const cfg = { dbDriver: "sqlite" as const, databaseUrl: "", sqlitePath: join(dir, "sub", "prices.db") };
      const s1 = await openStorage(cfg);
      await ingestSource(s1.repo, sources().a, opts);
      await s1.close();
      const s2 = await openStorage(cfg);
      open.push(s2);
      expect((await s2.repo.searchProducts("חלב", 5))[0]!.minPrice).toBe(6.9);
      // מוצר דומה שמגיע אחרי הפתיחה מחדש מתאים למוצר הקיים ולא נוצר כפול
      const b = sources().b;
      await ingestSource(s2.repo, b, opts);
      expect((await s2.repo.searchProducts("חלב תנובה", 5)).filter((p) => p.nameNorm.includes("חלב תנובה"))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ה-API (כולל /stores ו-CORS) עובד מעל SQLite", async () => {
    const { repo } = await mem();
    await ingestSource(repo, sources().a, opts);
    const app = createApp(new PriceService(repo), config, { corsOrigin: "http://localhost:5173" });
    const stores = (await (await app.request("/stores?online=false")).json()) as any;
    expect(stores.stores).toHaveLength(1);
    const res = await app.request("/health", { headers: { origin: "http://localhost:5173" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const search = (await (await app.request(`/products/search?q=${encodeURIComponent("אורז")}`)).json()) as any;
    expect(search.results[0].minPrice).toBe(12.9);
  });
});
