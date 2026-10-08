import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseFileName } from "../src/downloader/fileName.js";
import { extractShufersalLinks } from "../src/downloader/shufersal.js";
import { decodeXmlBuffer } from "../src/parser/decode.js";
import { parsePriceFile, parseStoresFile } from "../src/parser/priceFile.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));

describe("price file parsing (layouts captured from live files)", () => {
  it("parses a Shufersal-style file: UTF-8 BOM, ManufactureName tags", () => {
    const f = parsePriceFile(fx("shufersal-price.xml"));
    expect(f.chainId).toBe("7290027600007");
    expect(f.storeId).toBe("001");
    expect(f.subChainId).toBe("001");
    expect(f.items).toHaveLength(3);
    const first = f.items[0]!;
    expect(first.itemCode).toBe("7290016314779");
    expect(first.name).toContain("פילה מטיאס");
    expect(first.price).toBe(22.9);
    expect(first.manufacturer).toBe("סלטי שמיר 2006 בעמ");
    expect(first.quantity).toBe(220);
    expect(first.priceUpdatedAt?.toISOString()).toBe("2026-10-04T13:51:00.000Z");
  });
  it("turns 'לא ידוע' into null and keeps leading zeros of codes", () => {
    const f = parsePriceFile(fx("publishedprices-price.xml"));
    expect(f.items[0]!.manufacturer).toBeNull();
    const g = parsePriceFile("<Root><ChainID>1</ChainID><StoreID>7</StoreID><Items><Item><ItemCode>0012345</ItemCode><ItemName>x</ItemName><ItemPrice>1.5</ItemPrice></Item></Items></Root>");
    expect(g.items[0]!.itemCode).toBe("0012345");
  });
  it("counts rows without a usable price as skipped", () => {
    const g = parsePriceFile("<Root><ChainID>1</ChainID><Items><Item><ItemCode>1</ItemCode><ItemName>x</ItemName></Item></Items></Root>");
    expect(g.items).toHaveLength(0);
    expect(g.skipped).toBe(1);
  });
  it("handles the <Prices><Products><Product> variant", () => {
    const g = parsePriceFile("<Prices><ChainId>5</ChainId><SubChainId>2</SubChainId><StoreId>9</StoreId><Products><Product><ItemCode>5</ItemCode><ItemName>מוצר</ItemName><ItemPrice>3</ItemPrice></Product></Products></Prices>");
    expect(g.chainId).toBe("5");
    expect(g.items).toHaveLength(1);
  });
  it("reads gzip, UTF-16LE with BOM and windows-1255", () => {
    const xml = "<Root><ChainID>1</ChainID><Items></Items></Root>";
    expect(decodeXmlBuffer(gzipSync(Buffer.from(xml)))).toBe(xml);
    expect(decodeXmlBuffer(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]))).toBe(xml);
    const heb = Buffer.from([0x3c, 0x61, 0x3e, 0xe0, 0xe1, 0x3c, 0x2f, 0x61, 0x3e]); // <a>אב</a> in cp1255
    const withDecl = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1255"?>'), heb]);
    expect(decodeXmlBuffer(withDecl)).toContain("אב");
  });
});

describe("stores file", () => {
  it("parses a UTF-16LE Stores file with sub-chains", () => {
    const stores = parseStoresFile(fx("stores-utf16.xml"));
    expect(stores.length).toBe(3);
    expect(stores[0]).toMatchObject({ chainId: "7290058140886", subChainId: "001", storeId: "001" });
    expect(stores[0]!.name).toBeTruthy();
    expect(stores[0]!.city).toBe("3000"); // a CBS code in this chain, not a name
  });
});

describe("file names and listings", () => {
  it("parses price, store-less stores and promo names", () => {
    expect(parseFileName("PriceFull7290027600007-001-001-20261004-170000.gz")).toMatchObject({ kind: "pricefull", chainId: "7290027600007", subChainId: "001", storeId: "001" });
    const p = parseFileName("Price7290058140886-001-001-20261004-080012.gz");
    expect(p.kind).toBe("price");
    expect(p.publishedAt?.toISOString()).toBe("2026-10-04T08:00:12.000Z");
    expect(parseFileName("Stores7290058140886-000-20261004-050500.xml")).toMatchObject({ kind: "stores", subChainId: "000", storeId: null });
    expect(parseFileName("PriceFull7290027600007-123-20261004-1700.gz")).toMatchObject({ storeId: "123", subChainId: null });
    expect(parseFileName("README.txt").kind).toBe("unknown");
  });
  it("extracts signed blob links from the Shufersal listing html", () => {
    const html = `<tr><td><a href="https://pricesprodpublic.blob.core.windows.net/price/Price7290027600007-001-001-20261004-170000.gz?sv=2014-02-14&amp;sr=b&amp;sig=abc%2Fdef&amp;se=2026">הורד</a></td></tr>` +
      `<tr><td><a href="https://pricesprodpublic.blob.core.windows.net/stores/Stores7290027600007-000-20261004-020.gz?sv=1&amp;sig=x">הורד</a></td></tr>`;
    const files = extractShufersalLinks(html, "shufersal");
    expect(files).toHaveLength(2);
    expect(files[0]!.kind).toBe("price");
    expect(files[0]!.ref).toContain("&sig=abc%2Fdef");
    expect(files[0]!.ref).not.toContain("&amp;");
    expect(files[1]!.kind).toBe("stores");
  });
});
