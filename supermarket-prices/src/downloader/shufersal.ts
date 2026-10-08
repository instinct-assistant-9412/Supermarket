import type { ChainSource, FileKind, RemoteFile } from "../types.js";
import { parseFileName } from "./fileName.js";
import { fetchWithRetry, getBuffer, type HttpOptions } from "./http.js";

const BASE = "https://prices.shufersal.co.il";

/** The site's category ids (catID query parameter). */
const CATEGORY: Partial<Record<FileKind, number>> = { price: 1, pricefull: 2, promo: 3, promofull: 4, stores: 5 };

/** Shufersal uses UpdateCategory, not /?catID=N. Omit storeId when listing all stores.
 * Blob URLs expire after about 30 minutes. List immediately before downloading.
 * Footer page links determine the full result set; a safety cap throws instead of truncating.
 */
export class ShufersalSource implements ChainSource {
  key = "shufersal";
  name = "שופרסל";
  private downloaded = new Map<string, Buffer>();
  constructor(private http: HttpOptions, private maxPages = 1000) {}

  async listFiles(kinds: FileKind[], storeIds?: string[]): Promise<RemoteFile[]> {
    this.downloaded.clear();
    const out = new Map<string, RemoteFile>();
    for (const kind of [...new Set(kinds)]) {
      const cat = CATEGORY[kind];
      if (cat === undefined) continue;
      for (const storeId of (kind === "stores" || !storeIds ? [undefined] : [...new Set(storeIds)])) {
        let totalPages = 1;
        for (let page = 1; page <= totalPages; page++) {
          const query = new URLSearchParams({ catID: String(cat) });
          if (storeId) query.set("storeId", storeId);
          if (page > 1) query.set("page", String(page));
          const res = await fetchWithRetry(`${BASE}/FileObject/UpdateCategory?${query}`, { opts: { ...this.http, timeoutMs: 90_000, retries: this.http.retries ?? 2 } });
          if (!res.ok) throw new Error(`Shufersal listing HTTP ${res.status} (category ${cat}, page ${page})`);
          const html = await res.text();
          if (!html.includes('id="gridContainer"')) throw new Error("Shufersal directory format changed");
          totalPages = Math.max(totalPages, extractShufersalPageCount(html));
          if (totalPages > this.maxPages) throw new Error(`Shufersal needs ${totalPages} pages, above cap ${this.maxPages}`);
          const files = extractShufersalLinks(html, this.key);
          if (files.some((f) => f.kind !== kind)) throw new Error(`Shufersal category ${cat} returned wrong file kind`);
          if (files.length === 0 && totalPages > 1) throw new Error(`Shufersal empty page ${page} of ${totalPages}`);
          for (const f of files) {
            if (storeIds && f.kind !== "stores") {
              if (!f.storeId || !storeIds.some(id => Number(id) === Number(f.storeId))) throw new Error("Shufersal returned a foreign store");
              if (f.storeId === "413" && f.subChainId !== "002") throw new Error("Shufersal 413 must be in subchain 002");
              this.downloaded.set(f.ref, await getBuffer(f.ref, this.http));
            }
            out.set(f.name, f);
          }
        }
      }
    }
    return [...out.values()];
  }

  download(file: RemoteFile): Promise<Buffer> {
    const cached = this.downloaded.get(file.ref);
    return cached ? Promise.resolve(cached) : getBuffer(file.ref, this.http);
  }
}

export function extractShufersalLinks(html: string, chainKey: string): RemoteFile[] {
  const out: RemoteFile[] = [];
  const re = /href="(https:\/\/[^"]+?\/(?:price|stores|promo)[^"/]*\/([^"/?]+\.(?:gz|xml)))\?([^"]*)"/gi;
  for (const m of html.matchAll(re)) {
    const name = m[2]!;
    const url = `${m[1]!.replace(/&amp;/g, "&")}?${m[3]!.replace(/&amp;/g, "&")}`;
    const p = parseFileName(name);
    out.push({ chainKey, name, kind: p.kind, chainId: p.chainId, subChainId: p.subChainId, storeId: p.storeId, publishedAt: p.publishedAt, ref: url });
  }
  return out;
}

export function extractShufersalPageCount(html: string): number {
  const footer = html.match(/<tfoot\b[^>]*>([\s\S]*?)<\/tfoot>/i)?.[1] ?? "";
  return Math.max(1, ...[...footer.matchAll(/[?&](?:amp;)?page=(\d+)/g)].map((m) => Number(m[1])));
}
