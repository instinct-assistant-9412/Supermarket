import type { ChainSource, FileKind, RemoteFile } from "../types.js";
import { parseFileName } from "./fileName.js";
import { fetchWithRetry, getBuffer, type HttpOptions } from "./http.js";

const BASE = "https://prices.shufersal.co.il";

/** The site's category ids (catID query parameter). */
const CATEGORY: Partial<Record<FileKind, number>> = { price: 1, pricefull: 2, promo: 3, promofull: 4, stores: 5 };

/**
 * Shufersal publishes a paged HTML table; every row links to a time-limited signed blob URL
 * (about 30 minutes), so files must be downloaded right after listing.
 * Verified when this was written: the site's listing page and blob links, and the UTF-8 (BOM) XML inside the .gz;
 * the UpdateCategory endpoint returned Stores links for catID=5 once, but later calls timed out.
 * NOT verified: catID 1-4 mapping and the page parameter (see README "needs live testing").
 * Do not rely on "/?catID=N": that form returned price files for every catID.
 */
export class ShufersalSource implements ChainSource {
  key = "shufersal";
  name = "שופרסל";
  constructor(private http: HttpOptions, private maxPages = 5) {}

  async listFiles(kinds: FileKind[]): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    for (const kind of kinds) {
      const cat = CATEGORY[kind];
      if (cat === undefined) continue;
      for (let page = 1; page <= this.maxPages; page++) {
        const res = await fetchWithRetry(`${BASE}/FileObject/UpdateCategory?catID=${cat}&storeId=0&page=${page}`, { opts: this.http });
        if (!res.ok) break;
        const files = extractShufersalLinks(await res.text(), this.key);
        if (files.length === 0) break;
        out.push(...files.filter((f) => f.kind === kind));
      }
    }
    return out;
  }

  download(file: RemoteFile): Promise<Buffer> {
    return getBuffer(file.ref, this.http);
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
