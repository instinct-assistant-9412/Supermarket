import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePriceFile, parseStoresFile } from "../src/parser/priceFile.js";
const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
describe("captured October 4 chain files (trimmed)", () => {
  it("parses Carrefour PriceFull, retaining IDs and Hebrew", () => {
    const f = parsePriceFile(fixture("carrefour-pricefull.xml"));
    expect(f).toMatchObject({chainId:"7290055700007",subChainId:"001",storeId:"002",skipped:0});
    expect(f.items).toHaveLength(2);
    expect(f.items[0]?.name).toBeTruthy();
    expect(f.items[0]?.price).toBeGreaterThan(0);
  });
  it("parses Carrefour sub-chain stores and raw city codes", () => {
    const stores = parseStoresFile(fixture("carrefour-stores.xml"));
    expect(stores[0]).toMatchObject({chainId:"7290055700007",subChainId:"001",storeId:"002",city:"7100"});
    expect(stores[0]?.name).toContain("קרפור");
  });
  it("parses Shufersal stores including its numeric non-padded sub-chain", () => {
    const stores = parseStoresFile(fixture("shufersal-stores.xml"));
    expect(stores[0]).toMatchObject({chainId:"7290027600007",subChainId:"1",storeId:"756",city:"2530"});
    expect(stores[0]?.name).toBe("שלי באר יעקב");
  });
});
