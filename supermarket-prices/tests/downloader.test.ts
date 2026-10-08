import { afterEach, describe, expect, it, vi } from "vitest";
import { extractCarrefourFiles, CarrefourSource } from "../src/downloader/carrefour.js";
import { extractVictoryFiles, VictorySource } from "../src/downloader/victory.js";
import { extractShufersalLinks, extractShufersalPageCount, ShufersalSource } from "../src/downloader/shufersal.js";
import { sourceByKey } from "../src/downloader/registry.js";
const http = { userAgent: "test", retries: 0 };
const name = "PriceFull7290027600007-001-001-20261004-030000.gz";
const link = `<a href="https://pricesprodpublic.blob.core.windows.net/pricefull/${name}?sig=abc&amp;sp=r">file</a>`;
const page = (body: string) => `<div id="gridContainer">${body}</div>`;
afterEach(() => vi.unstubAllGlobals());

describe("Shufersal", () => {
  it("reads signed links, preserving leading zero IDs", () => {
    const [f] = extractShufersalLinks(link, "shufersal");
    expect(f).toMatchObject({ kind: "pricefull", storeId: "001", subChainId: "001", ref: expect.stringContaining("?sig=abc&sp=r") });
  });
  it("reads highest footer page, ignoring unrelated links", () => {
    expect(extractShufersalPageCount('<a href="?page=99"></a><tfoot><a href="?catID=2&amp;page=22">last</a></tfoot>')).toBe(22);
  });
  it("omits storeId=0, walks pages and deduplicates files", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(page(link + '<tfoot><a href="?catID=2&amp;page=2">next</a></tfoot>'))).mockResolvedValueOnce(new Response(page(link)));
    vi.stubGlobal("fetch", fetch);
    expect(await new ShufersalSource(http).listFiles(["pricefull", "pricefull"])).toHaveLength(1);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      "https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2",
      "https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&page=2",
    ]);
  });
  it("filters online listings by canonical store ID", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(page(link.replaceAll("-001-001-", "-001-413-"))));
    vi.stubGlobal("fetch", fetch);
    expect(await new ShufersalSource(http).listFiles(["pricefull"], ["413", "413"])).toHaveLength(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=413");
  });
  it("throws instead of silently truncating at a page cap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(page('<tfoot><a href="?page=22">last</a></tfoot>'))));
    await expect(new ShufersalSource(http, 5).listFiles(["pricefull"])).rejects.toThrow("above cap");
  });
  it("rejects wrong category responses and HTTP failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(page(link))));
    await expect(new ShufersalSource(http).listFiles(["stores"])).rejects.toThrow("wrong file kind");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    await expect(new ShufersalSource(http).listFiles(["pricefull"])).rejects.toThrow("403");
  });
});

describe("Carrefour", () => {
  const html = `const path = '20261004'; const files = [{"name":"PriceFull7290055700007-001-002-20261004-051019.gz"},{"name":"Stores7290055700007-000-20261004-000100.xml"},{"name":"../../bad.xml"}];`;
  it("extracts date directory JSON without eval and filters unsafe names", () => {
    const files = extractCarrefourFiles(html);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({kind:"pricefull",chainId:"7290055700007",storeId:"002",ref:"https://prices.carrefour.co.il/20261004/PriceFull7290055700007-001-002-20261004-051019.gz"});
  });
  it("fails clearly on changed directory format", () => {
    expect(() => extractCarrefourFiles("<html>login</html>")).toThrow("format changed");
    expect(() => extractCarrefourFiles(html.replace("'20261004'", "'../'"))).toThrow("Invalid");
  });
  it("lists only requested kinds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html)));
    expect(await new CarrefourSource(http).listFiles(["stores"])).toHaveLength(1);
  });
});

describe("Victory", () => {
  const name = "PriceFull7290058103393-001-20261004-030000.gz";
  it("uses each file's chain ID in download URL and rejects foreign files", () => {
    const data = [{fileName:name,fileType:"PriceFull"},{fileName:"../x.xml"}];
    const [f] = extractVictoryFiles(data,"7290058103393");
    expect(f).toMatchObject({kind:"pricefull",storeId:"001",ref:`https://laibcatalog.co.il/webapi/7290058103393/${name}`});
    expect(extractVictoryFiles(data,"7290696200003")).toEqual([]);
    expect(() => extractVictoryFiles({},"7290058103393")).toThrow("expected array");
  });
  it("skips inactive roots and requests one catalog per active chain", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("[]")).mockResolvedValueOnce(new Response('[{"branchNumber":1}]')).mockResolvedValueOnce(new Response(JSON.stringify([{fileName:name}])));
    vi.stubGlobal("fetch",fetch);
    expect(await new VictorySource(http).listFiles(["pricefull"])).toHaveLength(1);
    expect(fetch.mock.calls.map(c=>c[0])).toEqual([
      "https://laibcatalog.co.il/webapi/api/getbranches?edi=7290696200003",
      "https://laibcatalog.co.il/webapi/api/getbranches?edi=7290058103393",
      "https://laibcatalog.co.il/webapi/api/getfiles?edi=7290058103393",
    ]);
  });
});
it("registers all three sources", () => {
  for (const key of ["carrefour","shufersal","victory"]) expect(sourceByKey(key,http)?.key).toBe(key);
});
