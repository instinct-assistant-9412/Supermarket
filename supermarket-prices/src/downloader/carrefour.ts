import type { ChainSource, FileKind, RemoteFile } from "../types.js";
import { parseFileName } from "./fileName.js";
import { fetchWithRetry, getBuffer, type HttpOptions } from "./http.js";

export const CARREFOUR_BASE = "https://prices.carrefour.co.il/";

/** The public directory embeds JSON, not executable code. Never eval its scripts. */
export function extractCarrefourFiles(html: string): RemoteFile[] {
  const path = html.match(/\bconst\s+path\s*=\s*['"]([^'"]*)['"]\s*;/)?.[1];
  const json = html.match(/\bconst\s+files\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1];
  if (path === undefined || !json) throw new Error("Carrefour directory format changed: missing path/files");
  if (!/^\d{8}$/.test(path)) throw new Error("Invalid Carrefour date directory");
  const rows: unknown = JSON.parse(json);
  if (!Array.isArray(rows)) throw new Error("Invalid Carrefour files array");
  return rows.flatMap((row: unknown) => {
    if (!row || typeof row !== "object" || !("name" in row) || typeof row.name !== "string") return [];
    const name = row.name;
    if (!/^[\w.-]+\.(gz|xml)$/i.test(name)) return [];
    const p = parseFileName(name);
    if (p.kind === "unknown" || p.chainId !== "7290055700007") return [];
    return [{ chainKey: "carrefour", name, ...p, ref: new URL(`${path}/${name}`, CARREFOUR_BASE).href }];
  });
}

/** Includes Carrefour and legacy Yeynot Bitan branches under the same published chain ID. */
export class CarrefourSource implements ChainSource {
  key = "carrefour";
  name = "קרפור / יינות ביתן";
  constructor(private http: HttpOptions) {}
  async listFiles(kinds: FileKind[]): Promise<RemoteFile[]> {
    const res = await fetchWithRetry(CARREFOUR_BASE, { opts: this.http });
    if (!res.ok) throw new Error(`Carrefour listing HTTP ${res.status}`);
    return extractCarrefourFiles(await res.text()).filter((f) => kinds.includes(f.kind));
  }
  download(file: RemoteFile): Promise<Buffer> {
    const url = new URL(file.ref);
    if (url.origin !== new URL(CARREFOUR_BASE).origin || file.chainKey !== this.key) throw new Error("Foreign Carrefour download");
    return getBuffer(url.href, this.http);
  }
}
