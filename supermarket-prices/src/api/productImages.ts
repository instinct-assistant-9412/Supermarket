import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isValidGtin } from "../normalize/gtin.js";

export interface ProductImage {
  url: string | null;
  sourceUrl?: string;
  licenseUrl?: string;
  retryAfter?: number;
}
type Entry = { expires: number; image: ProductImage };
const LICENSE = "https://creativecommons.org/licenses/by-sa/3.0/";

/** Exact barcode only. No chain scraping, price data or image bytes are imported. */
export class ProductImages {
  private cache = new Map<string, Entry>();
  private ready: Promise<void>;
  private busy = false;
  private nextRequest = 0;
  constructor(private path: string, private fetcher: typeof fetch = fetch, private now = Date.now) {
    this.ready = this.load();
  }
  private async load() {
    try {
      const entries = JSON.parse(await readFile(this.path, "utf8")) as [string, Entry][];
      for (const [code, entry] of entries) {
        if (isValidGtin(code) && entry.expires > this.now() && this.safeImage(entry.image.url)) this.cache.set(code, entry);
      }
    } catch { /* First start or corrupt cache: images stay optional. */ }
  }
  private safeImage(url: unknown): url is string | null {
    if (url === null) return true;
    if (typeof url !== "string") return false;
    try { const u = new URL(url); return u.protocol === "https:" && u.hostname === "images.openfoodfacts.org" && u.pathname.startsWith("/images/products/"); }
    catch { return false; }
  }
  private async save() {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify([...this.cache]));
    await rename(`${this.path}.tmp`, this.path);
  }
  async get(code: string): Promise<ProductImage> {
    // Canonical GTIN only; no arbitrary URLs or chain internal identifiers.
    if (!/^\d{13}$/.test(code) || !isValidGtin(code) || code.startsWith("2")) return { url: null };
    await this.ready;
    const cached = this.cache.get(code);
    if (cached && cached.expires > this.now()) return cached.image;
    // No unbounded queue. Maximum 12 calls/minute, below OFF's 15/minute limit.
    if (this.busy || this.now() < this.nextRequest) return { url: null, retryAfter: Math.max(5, Math.ceil((this.nextRequest - this.now()) / 1000)) };
    this.busy = true;
    this.nextRequest = this.now() + 5000;
    try {
      const res = await this.fetcher(`https://world.openfoodfacts.org/api/v3.6/product/${code}.json?fields=code,image_front_small_url,selected_images`, {
        headers: { "User-Agent": process.env.IMAGE_USER_AGENT ?? "SupermarketPrices/0.1 (https://github.com/snir0542/Supermarket)" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429 || res.status === 503) {
        this.nextRequest = this.now() + Math.max(60, Number(res.headers.get("retry-after")) || 60) * 1000;
        return { url: null, retryAfter: Math.ceil((this.nextRequest - this.now()) / 1000) };
      }
      if (!res.ok && res.status !== 404) throw new Error("image source unavailable");
      const body = await res.json() as { code?: string; product?: { code?: string; image_front_small_url?: string; selected_images?: { front?: { small?: Record<string, string> } } } };
      const p = body.product;
      const candidate = p?.selected_images?.front?.small?.he ?? p?.image_front_small_url ?? null;
      const url = (body.code === code || p?.code === code) && this.safeImage(candidate) ? candidate : null;
      const image: ProductImage = url ? { url, sourceUrl: `https://world.openfoodfacts.org/product/${code}`, licenseUrl: LICENSE } : { url: null };
      this.cache.set(code, { expires: this.now() + (url ? 7 : 1) * 86400_000, image });
      // Limit storage even if exposed to arbitrary valid barcodes.
      if (this.cache.size > 10000) this.cache.delete(this.cache.keys().next().value!);
      await this.save().catch(() => {});
      return image;
    } catch {
      const image = { url: null, retryAfter: 60 };
      this.cache.set(code, { expires: this.now() + 60_000, image });
      return image;
    }
    finally { this.busy = false; }
  }
}
