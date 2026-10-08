import { afterEach, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { ShufersalSource } from "../src/downloader/shufersal.js";
import { VictorySource, VICTORY_MIRROR_LATEST, victoryMirrorZipUrls } from "../src/downloader/victory.js";
const http = { userAgent: "test", retries: 0 };
const zipUrl = "https://pub-63c02556dabd4956af9500eb8fe7198c.r2.dev/datasets/e500decb-7bd5-41e6-a19f-f5c3ddf7b2c5/v1/test.zip";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("downloads literal Shufersal 413 SAS immediately, with a 90-second listing budget", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const name = "PriceFull7290027600007-002-413-20261008-034000.gz";
  const url = `https://pricesprodpublic.blob.core.windows.net/pricefull/${name}?sig=a%2Bb%3D&sp=r`;
  const fetch = vi.fn().mockResolvedValueOnce(new Response(`<div id="gridContainer"><a href="${url.replace("&", "&amp;")}"></a></div>`)).mockResolvedValueOnce(new Response("payload"));
  vi.stubGlobal("fetch", fetch);
  const src = new ShufersalSource(http);
  const files = await src.listFiles(["pricefull"], ["413"]);
  expect(files[0]).toMatchObject({ subChainId: "002", storeId: "413", ref: url });
  expect(fetch.mock.calls.map(c => c[0])).toEqual(["https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=413", url]);
  expect(timeout).toHaveBeenCalledWith(90_000);
  expect((await src.download(files[0]!)).toString()).toBe("payload");
  expect(fetch).toHaveBeenCalledTimes(2);
  timeout.mockRestore();
});
it("retries a transient Shufersal failure a bounded number of times", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValue(new Error("timeout")); vi.stubGlobal("fetch", fetch);
  const result = new ShufersalSource({userAgent:"test",retries:1}).listFiles(["stores"]);
  const rejected = expect(result).rejects.toThrow("timeout");
  await vi.runAllTimersAsync(); await rejected; expect(fetch).toHaveBeenCalledTimes(2);
});
it("follows latest-version ZIP metadata and returns only Victory online 097 plus Stores", async () => {
  const name = "PriceFull7290696200003-001-097-20261008-051546.gz";
  const stores = "Stores7290696200003-000-20261008060100-060100.gz";
  const zip = zipSync({["ויקטורי/attachments/"+name]:new TextEncoder().encode("online"),[stores]:new TextEncoder().encode("stores"),"PriceFull7290696200003-001-001-20261008-051546.gz":new Uint8Array([1]),"PriceFull7290027600007-002-413-20261008-034000.gz":new Uint8Array([2])});
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({resources:[{format:"ZIP",download_url:zipUrl}]}))).mockResolvedValueOnce(new Response(Buffer.from(zip)));
  vi.stubGlobal("fetch",fetch); const src = new VictorySource(http);
  const files = await src.listFiles(["pricefull","stores"], ["097"]);
  expect(files.map(f=>f.name)).toEqual(expect.arrayContaining([name,stores])); expect(files).toHaveLength(2);
  expect((await src.download(files.find(f=>f.kind==="pricefull")!)).toString()).toBe("online");
  expect(fetch.mock.calls.map(c=>c[0])).toEqual([VICTORY_MIRROR_LATEST,zipUrl]);
  expect(fetch.mock.calls[1]![1].headers).toMatchObject({"user-agent":"Mozilla/5.0",referer:"https://www.over.org.il/"});
  expect(()=>src.download({...files[0]!,chainId:"bad"})).toThrow();
});
it("fails closed on missing/foreign mirror ZIP metadata", () => {
  for (const data of [{}, {resources:[]}, {resources:[{format:"ZIP",download_url:"https://example.com/x.zip"}]}]) expect(()=>victoryMirrorZipUrls(data)).toThrow();
});
