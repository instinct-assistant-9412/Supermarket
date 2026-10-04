import { describe, expect, it } from "vitest";
import { parseFileName } from "../src/downloader/fileName.js";
import { ingestSource, reconcileStoreId } from "../src/ingest/ingest.js";
import { MemoryRepository } from "../src/ingest/memoryRepository.js";
import { loadConfig } from "../src/config.js";
import { parsePriceFile, parseStoresFile } from "../src/parser/priceFile.js";
import { PriceService } from "../src/service.js";
import { MockSource, gtin13, priceXml, storesXml } from "./helpers.js";

const config = loadConfig({});
const opts = { config, now: () => new Date("2026-10-04T08:00:00Z") };
const t = new Date("2026-10-04T06:00:00Z");
const MILK = gtin13("729001000001");

// The three verified online stores (2026-10-04): chain id, sub-chain, store id, store name, file name
const CHAINS = [
  { key: "shufersal", chain: "7290027600007", sub: "2", store: "413", name: "שופרסל ONLINE", file: "PriceFull7290027600007-002-413-20261004-030000.gz", price: 7.9 },
  { key: "carrefour", chain: "7290055700007", sub: "001", store: "471", name: "קרפור אונליין כפר סבא", file: "PriceFull7290055700007-001-471-20261004-030000.gz", price: 7.5 },
  { key: "rami-levy", chain: "7290058140886", sub: "001", store: "039", name: "מרלוג אינטרנט", file: "pricefull7290058140886-039-202610040300.gz", price: 7.2 },
] as const;

function source(c: (typeof CHAINS)[number], xmlStore: string = c.store) {
  const s = new MockSource(c.key, c.key);
  s.add(`Stores${c.chain}-000-20261004-0500.xml`, "stores", c.chain, c.sub, null, t, storesXml(c.chain, [
    { sub: c.sub, id: c.store, name: c.name, city: "0", address: "-", type: 2 },
    { sub: c.sub, id: "5", name: "סניף פיזי", city: "ראש העין", address: "הרצל 1", type: 1 },
  ]));
  const p = parseFileName(c.file);
  s.add(c.file, "pricefull", c.chain, p.subChainId ?? c.sub, p.storeId, t, priceXml(c.chain, c.sub, xmlStore, [{ code: MILK, name: "חלב תנובה 3% 1 ליטר", price: c.price }]));
  s.add(`PriceFull${c.chain}-${c.sub}-005-20261004-030000.gz`, "pricefull", c.chain, c.sub, "005", t, priceXml(c.chain, c.sub, "5", [{ code: MILK, name: "חלב תנובה 3% 1 ליטר", price: c.price - 1 }]));
  return s;
}

describe("online stores (StoreType=2)", () => {
  it("parses StoreType into isOnline", () => {
    for (const c of CHAINS) {
      const stores = parseStoresFile(storesXml(c.chain, [{ sub: c.sub, id: c.store, name: c.name, city: "0", address: "-", type: 2 }, { sub: c.sub, id: "5", name: "x", city: "y", address: "z", type: 1 }, { sub: c.sub, id: "6", name: "x", city: "y", address: "z" }]));
      expect(stores.map((s) => s.isOnline)).toEqual([true, false, false]);
    }
  });

  it("parses file names of all three online stores, including Rami Levy's lowercase names", () => {
    expect(parseFileName(CHAINS[0].file)).toMatchObject({ kind: "pricefull", chainId: "7290027600007", subChainId: "002", storeId: "413" });
    expect(parseFileName(CHAINS[1].file)).toMatchObject({ kind: "pricefull", chainId: "7290055700007", subChainId: "001", storeId: "471" });
    expect(parseFileName("pricefull7290058140886-039-202610040300.gz")).toMatchObject({ kind: "pricefull", chainId: "7290058140886", storeId: "039" });
    expect(parseFileName("promofull7290058140886-039-202610040300.gz").kind).toBe("promofull");
    expect(parseFileName("stores7290058140886-000-202610040300.xml").kind).toBe("stores");
  });

  it.each(CHAINS)("ingests only the online store of $key with onlineOnly", async (c) => {
    const repo = new MemoryRepository();
    const sum = await ingestSource(repo, source(c), { ...opts, onlineOnly: true });
    expect(sum.failures).toEqual([]);
    expect(sum.filesIngested).toBe(1);
    expect(sum.runs[0]).toMatchObject({ chainId: c.chain, itemsTotal: 1 });
    const online = [...repo.stores.values()].filter((s) => s.isOnline);
    expect(online).toHaveLength(1);
    expect(online[0]).toMatchObject({ storeId: c.store, name: c.name });
  });

  it("links Carrefour by file name when the XML StoreID differs (471 vs 530)", async () => {
    const c = CHAINS[1];
    const repo = new MemoryRepository();
    const sum = await ingestSource(repo, source(c, "530"), { ...opts, onlineOnly: true });
    expect(sum.failures).toEqual([]);
    expect(sum.runs[0]?.storeId).toBe("001-471");
    expect(sum.runs[0]?.issues.join()).toContain("STORE_ID_FROM_FILENAME");
    expect([...repo.stores.values()].some((s) => s.storeId === "530")).toBe(false);
  });

  it("normalizes zero padding silently (XML 39, file name and Stores 039)", () => {
    const parsed = { chainId: "1", subChainId: "1", storeId: "39", items: [], skipped: 0 };
    const out = reconcileStoreId(parsed, { chainKey: "x", name: "n", kind: "pricefull", chainId: "1", subChainId: null, storeId: "039", publishedAt: null, ref: "n" });
    expect(out.note).toBeNull();
    expect(out.file.storeId).toBe("039");
  });

  it("uses the Stores file spelling when the XML pads IDs differently (Rami Levy sub 1/store 39 vs 001/039)", async () => {
    const c = CHAINS[2];
    const s = new MockSource(c.key, c.key);
    s.add(`Stores${c.chain}-000-20261004-0500.xml`, "stores", c.chain, "001", null, t, storesXml(c.chain, [{ sub: "001", id: "039", name: c.name, city: "6100", address: "-", type: 2 }]));
    s.add(c.file, "pricefull", c.chain, null, "039", t, priceXml(c.chain, "1", "39", [{ code: MILK, name: "חלב תנובה 3% 1 ליטר", price: c.price }]));
    const repo = new MemoryRepository();
    const sum = await ingestSource(repo, s, { ...opts, onlineOnly: true });
    expect(sum.failures).toEqual([]);
    expect(repo.stores.size).toBe(1);
    const basket = await new PriceService(repo).cheapestBasket([{ gtin: MILK }], { online: true });
    expect(basket.stores).toHaveLength(1);
    expect(basket.stores[0]).toMatchObject({ isOnline: true, storeName: c.name, total: 7.2 });
  });

  it("keeps online and physical stores apart in basket comparisons", async () => {
    const repo = new MemoryRepository();
    for (const c of CHAINS) await ingestSource(repo, source(c), opts);
    const service = new PriceService(repo);
    const online = await service.cheapestBasket([{ gtin: MILK }], { online: true });
    expect(online.stores).toHaveLength(3);
    expect(online.stores.every((s) => s.isOnline)).toBe(true);
    expect(online.stores[0]).toMatchObject({ chainId: "7290058140886", total: 7.2 });
    const physical = await service.cheapestBasket([{ gtin: MILK }], {});
    expect(physical.stores).toHaveLength(3);
    expect(physical.stores.every((s) => !s.isOnline)).toBe(true);
    expect(physical.stores[0]?.total).toBe(6.2); // 7.2 - 1: physical Rami Levy, never the online 7.2 mixed in
  });
});

describe("Rami Levy serves ZIP archives under a .gz name", () => {
  it("decodes a deflated ZIP and a stored ZIP", async () => {
    const { deflateRawSync } = await import("node:zlib");
    const { decodeXmlBuffer } = await import("../src/parser/decode.js");
    const xml = priceXml("7290058140886", "001", "039", [{ code: MILK, name: "חלב תנובה 3% 1 ליטר", price: 7.2 }]);
    const zip = (data: Buffer, method: number, raw: Buffer) => {
      const name = Buffer.from("PriceFull7290058140886-039-202610040514.xml");
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
      const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
      const cdOff = lh.length + name.length + data.length;
      const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length + name.length, 12); end.writeUInt32LE(cdOff, 16);
      return Buffer.concat([lh, name, data, cd, name, end]);
    };
    const raw = Buffer.from("\ufeff" + xml, "utf8");
    for (const [method, data] of [[8, deflateRawSync(raw)], [0, raw]] as const) {
      const f = parsePriceFile(zip(data, method, raw));
      expect(f).toMatchObject({ chainId: "7290058140886", storeId: "039" });
      expect(f.items).toHaveLength(1);
    }
    expect(decodeXmlBuffer(zip(deflateRawSync(raw), 8, raw))).toContain("<ItemCode>");
  });
});
