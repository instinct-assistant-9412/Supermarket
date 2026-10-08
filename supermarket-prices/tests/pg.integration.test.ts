import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { PgRepository } from "../src/db/pgRepository.js";
import { createPool, migrate } from "../src/db/pool.js";
import { ingestSource } from "../src/ingest/ingest.js";
import { PriceService } from "../src/service.js";
import { MockSource, gtin13, priceXml, storesXml } from "./helpers.js";

/** Runs only when TEST_DATABASE_URL points at an empty Postgres with the pg_trgm extension available. */
const url = process.env.TEST_DATABASE_URL;
const MILK = gtin13("729001000001");
const RICE = gtin13("729001000002");
const t1 = new Date("2026-10-04T06:00:00Z");
const t2 = new Date("2026-10-05T06:00:00Z");
const config = loadConfig({});

describe.skipIf(!url)("Postgres repository (real database)", () => {
  const pool = createPool(url ?? "");
  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("ingests, matches, keeps history, answers search and basket", async () => {
    const repo = new PgRepository(pool);
    const a = new MockSource("a", "רשת א");
    a.add("Stores111-000-20261004-0500.xml", "stores", "111", "000", null, t1, storesXml("111", [{ sub: "1", id: "1", name: "סניף מרכז", city: "ראש העין", address: "הרצל 1" }]));
    a.add("PriceFull111-001-001-20261004-0600.gz", "pricefull", "111", "1", "1", t1, priceXml("111", "1", "1", [
      { code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 6.9 },
      { code: RICE, name: "אורז בסמטי סוגת 1 קג", price: 12.9 },
      { code: "5001", name: "עגבניות שרי אורגניות 500 גרם", price: 14.9, type: 0 },
    ]));
    const b = new MockSource("b", "רשת ב");
    b.add("Stores222-000-20261004-0500.xml", "stores", "222", "000", null, t1, storesXml("222", [{ sub: "1", id: "7", name: "סניף צפון", city: "ראש העין", address: "סירקין 3" }]));
    b.add("PriceFull222-001-007-20261004-0600.gz", "pricefull", "222", "1", "7", t1, priceXml("222", "1", "7", [
      { code: MILK, name: "חלב תנובה 3 אחוז 1 ל'", price: 6.5 },
      { code: RICE, name: "אורז בסמטי סוגת 1 קילו", price: 13.5 },
      { code: "77", name: "עגבניות שרי אורגניות 500 גר", price: 12.9, type: 0 },
    ]));
    const opts = { config, now: () => new Date("2026-10-04T08:00:00Z") };
    expect((await ingestSource(repo, a, opts)).failures).toEqual([]);
    expect((await ingestSource(repo, b, opts)).failures).toEqual([]);

    const products = await pool.query("SELECT count(*)::int AS n FROM products");
    expect(products.rows[0].n).toBe(3); // milk, rice, tomatoes shared across chains
    const ci = await pool.query("SELECT match_method FROM chain_items WHERE chain_id='222' AND item_code='77'");
    expect(ci.rows[0].match_method).toBe("fuzzy");

    const service = new PriceService(repo);
    const basket = await service.cheapestBasket([{ gtin: MILK, qty: 2 }, { query: "אורז בסמטי" }], { text: "ראש העין" });
    expect(basket.stores[0]).toMatchObject({ chainId: "222", total: 26.5 });
    expect(basket.stores[1]).toMatchObject({ chainId: "111", total: 26.7 });

    a.add("PriceFull111-001-001-20261005-0600.gz", "pricefull", "111", "1", "1", t2, priceXml("111", "1", "1", [{ code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 7.2 }]));
    await ingestSource(repo, a, opts);
    const h = await service.priceHistory({ gtin: MILK }, { chainId: "111" });
    expect(h!.points.map((p) => p.price)).toEqual([6.9, 7.2]);

    const hits = await service.searchProducts("חלב תנובה");
    expect(hits[0]!.chains).toBe(2);
    expect(hits[0]!.minPrice).toBe(6.5);
    expect((await service.freshness()).map((f) => f.chainId)).toEqual(["111", "222"]);
  });
});
