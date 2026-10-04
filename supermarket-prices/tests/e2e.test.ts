import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { loadConfig } from "../src/config.js";
import { ingestSource } from "../src/ingest/ingest.js";
import { MemoryRepository } from "../src/ingest/memoryRepository.js";
import { buildMcpServer } from "../src/mcp/tools.js";
import { PriceService } from "../src/service.js";
import { MockSource, gtin13, priceXml, storesXml } from "./helpers.js";

const config = loadConfig({});
const MILK = gtin13("729001000001");
const RICE = gtin13("729001000002");
const OIL = gtin13("729001000003");
const t1 = new Date("2026-10-04T06:00:00Z");
const t2 = new Date("2026-10-05T06:00:00Z");
const opts = { config, now: () => new Date("2026-10-04T08:00:00Z") };

function build() {
  const a = new MockSource("chain-a", "רשת א");
  a.add("Stores111-000-20261004-0500.xml", "stores", "111", "000", null, t1, storesXml("111", [{ sub: "1", id: "1", name: "סניף מרכז", city: "ראש העין", address: "הרצל 1" }]));
  a.add("PriceFull111-001-001-20261004-0600.gz", "pricefull", "111", "1", "1", t1, priceXml("111", "1", "1", [
    { code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 6.9 },
    { code: RICE, name: "אורז בסמטי סוגת 1 קג", price: 12.9 },
    { code: "5001", name: "עגבניות שרי אורגניות 500 גרם", price: 14.9, type: 0 },
  ]));
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

describe("mocked end-to-end ingest", () => {
  it("ingests two chains, matches by GTIN and by fuzzy name, tracks history and answers basket queries", async () => {
    const repo = new MemoryRepository();
    const { a, b } = build();
    const sa = await ingestSource(repo, a, opts);
    const sb = await ingestSource(repo, b, opts);
    expect(sa.failures).toEqual([]);
    expect(sb.failures).toEqual([]);
    expect(sa.filesIngested).toBe(1);
    expect(sb.filesIngested).toBe(2);

    // same barcode in both chains -> one product
    const milkProducts = repo.products.filter((p) => p.gtin === "0" + MILK.slice(0, 12) || p.gtin === MILK);
    expect(milkProducts).toHaveLength(1);
    // internal-code produce matched by name across chains (different codes, size-guarded)
    const tomato = repo.products.filter((p) => p.nameNorm.includes("עגבניות שרי"));
    expect(tomato).toHaveLength(1);
    expect(repo.chainItems.get("222:77")?.matchMethod).toBe("fuzzy");

    // re-run: files already ingested are skipped
    const again = await ingestSource(repo, a, opts);
    expect(again.filesIngested).toBe(0);
    expect(again.filesSkipped).toBe(1);

    const service = new PriceService(repo);
    const basket = await service.cheapestBasket([{ gtin: MILK, qty: 2 }, { query: "אורז בסמטי" }], { text: "ראש העין" });
    expect(basket.complete).toBe(true);
    // chain 111: 2*6.9+12.9 = 26.7 ; chain 222 store 7: 2*6.5+13.5 = 26.5 -> 222 is cheaper
    expect(basket.stores[0]).toMatchObject({ chainId: "222", total: 26.5 });
    expect(basket.stores[1]).toMatchObject({ chainId: "111", total: 26.7 });
    // the Eilat store is outside the area
    expect(basket.stores.some((s) => s.city === "אילת")).toBe(false);
  });

  it("records price history only when the price changes", async () => {
    const repo = new MemoryRepository();
    const { a } = build();
    await ingestSource(repo, a, opts);
    a.add("PriceFull111-001-001-20261005-0600.gz", "pricefull", "111", "1", "1", t2, priceXml("111", "1", "1", [
      { code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 7.2 },
      { code: RICE, name: "אורז בסמטי סוגת 1 קג", price: 12.9 },
      { code: "5001", name: "עגבניות שרי אורגניות 500 גרם", price: 14.9, type: 0 },
    ]));
    const sum = await ingestSource(repo, a, opts);
    expect(sum.runs[0]!.priceChanges).toBe(1);
    const service = new PriceService(repo);
    const h = await service.priceHistory({ gtin: MILK }, {});
    expect(h!.points.map((p) => p.price)).toEqual([6.9, 7.2]);
    expect(repo.history).toHaveLength(4); // 3 first-time rows + 1 change, unchanged rice/tomato not repeated
  });

  it("rejects a file whose ChainID does not match the source and writes nothing", async () => {
    const repo = new MemoryRepository();
    const a = new MockSource("chain-a", "רשת א");
    a.add("PriceFull111-001-001-20261004-0600.gz", "pricefull", "111", "1", "1", t1, priceXml("999", "1", "1", [{ code: MILK, name: "חלב", price: 6 }]));
    const sum = await ingestSource(repo, a, opts);
    expect(sum.runs[0]!.status).toBe("failed");
    expect(repo.current.size).toBe(0);
  });

  it("flags invalid prices and sends similar-but-below-threshold names to review", async () => {
    const repo = new MemoryRepository();
    const a = new MockSource("chain-a", "רשת א");
    a.add("PriceFull111-001-001-20261004-0600.gz", "pricefull", "111", "1", "1", t1, priceXml("111", "1", "1", [
      { code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 0 },
      { code: "9", name: "גבינה לבנה תנובה 5% 250 גרם", price: 6 },
      { code: "10", name: "גבינה לבנה תנובה 9% 250 גרם", price: 7, type: 0 },
    ]));
    const sum = await ingestSource(repo, a, opts);
    expect(sum.runs[0]!.itemsInvalid).toBe(1);
    expect(sum.runs[0]!.status).toBe("warning");
  });

  it("serves the HTTP API", async () => {
    const repo = new MemoryRepository();
    const { a, b } = build();
    await ingestSource(repo, a, opts);
    await ingestSource(repo, b, opts);
    const app = createApp(new PriceService(repo), config);
    const search = await (await app.request(`/products/search?q=${encodeURIComponent("חלב תנובה")}`)).json() as any;
    expect(search.results[0].chains).toBe(2);
    expect(search.results[0].minPrice).toBe(5.9);
    const hist = await app.request(`/products/${MILK}/history`);
    expect(hist.status).toBe(200);
    expect((await app.request(`/products/0000000000000/history`)).status).toBe(404);
    const basket = await app.request("/basket/cheapest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ gtin: MILK, qty: 1 }], area: { text: "אילת" } }),
    });
    const bj = await basket.json() as any;
    expect(bj.stores).toHaveLength(1);
    expect(bj.stores[0].total).toBe(5.9);
    expect((await app.request("/basket/cheapest", { method: "POST", body: "{}" })).status).toBe(400);
    const q = await (await app.request("/quality/freshness")).json() as any;
    expect(q.chains.map((c: any) => c.chainId).sort()).toEqual(["111", "222"]);
  });

  it("serves the MCP tools", async () => {
    const repo = new MemoryRepository();
    const { a } = build();
    await ingestSource(repo, a, opts);
    const server = buildMcpServer(new PriceService(repo), config);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(ct);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["cheapest_basket", "data_freshness", "price_history", "search_products"]);
    const res = (await client.callTool({ name: "search_products", arguments: { query: "אורז בסמטי" } })) as { content: Array<{ text: string }> };
    expect(JSON.parse(res.content[0]!.text)[0].minPrice).toBe(12.9);
  });
});
