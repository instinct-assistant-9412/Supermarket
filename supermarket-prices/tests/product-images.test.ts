import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductImages } from "../src/api/productImages.js";
const code = "7290004127329";
async function setup(body: unknown, status = 200) {
  const path = join(await mkdtemp(join(tmpdir(), "images-")), "cache.json");
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  let time = 100000;
  const images = new ProductImages(path, fetcher, () => time);
  return { path, fetcher, images, advance: (n: number) => { time += n; } };
}
describe("optional product images", () => {
  it("prefers Hebrew, hotlinks approved host, and persists metadata only", async () => {
    const url = "https://images.openfoodfacts.org/images/products/729/000/412/7329/front_he.29.200.jpg";
    const s = await setup({ code, product: { code, selected_images: { front: { small: { he: url } } } } });
    expect((await s.images.get(code)).url).toBe(url);
    expect((await s.images.get(code)).url).toBe(url);
    expect(s.fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(s.path, "utf8")).toContain("creativecommons.org");
    const restored = new ProductImages(s.path, s.fetcher, () => 100000);
    expect((await restored.get(code)).url).toBe(url);
    expect(s.fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not look up internal, invalid, restricted or arbitrary identifiers", async () => {
    const s = await setup({});
    for (const c of ["", "123", "https://localhost", "7290004127328", "2000000000008"]) expect(await s.images.get(c)).toEqual({ url: null });
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("rejects wrong barcode and unsafe URLs", async () => {
    for (const body of [{code:"1111111111111",product:{image_front_small_url:"https://images.openfoodfacts.org/images/products/x.jpg"}}, {code,product:{image_front_small_url:"https://evil.example/x.jpg"}}]) {
      const s = await setup(body); expect(await s.images.get(code)).toEqual({ url: null });
    }
  });
  it("negative caches missing photos", async () => {
    const s = await setup({ code }); await s.images.get(code); await s.images.get(code); expect(s.fetcher).toHaveBeenCalledTimes(1);
  });
  it("enforces upstream spacing and backs off on throttling", async () => {
    const s = await setup({},429); expect((await s.images.get(code)).retryAfter).toBe(60);
    expect((await s.images.get(code)).retryAfter).toBe(60);expect(s.fetcher).toHaveBeenCalledTimes(1);
    s.advance(60000);await s.images.get(code);expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
});
