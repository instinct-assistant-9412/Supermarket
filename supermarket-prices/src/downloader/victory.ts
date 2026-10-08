import { unzipSync } from "fflate";
import type { ChainSource, FileKind, RemoteFile } from "../types.js";
import { parseFileName } from "./fileName.js";
import { fetchWithRetry, getBuffer, type HttpOptions } from "./http.js";

export const VICTORY_BASE = "https://laibcatalog.co.il";
export const VICTORY_CHAIN_IDS = ["7290696200003"] as const;
export const VICTORY_MIRROR_LATEST = "https://www.over.org.il/api/v1/datasets/e500decb-7bd5-41e6-a19f-f5c3ddf7b2c5/versions/latest";
const MIRROR_HOST = "pub-63c02556dabd4956af9500eb8fe7198c.r2.dev";
const MIRROR_PREFIX = "/datasets/e500decb-7bd5-41e6-a19f-f5c3ddf7b2c5/";
const MIRROR_HEADERS = { "user-agent": "Mozilla/5.0", referer: "https://www.over.org.il/" };

/** Direct adapter retained for deployments with working Israeli egress. */
export function extractVictoryFiles(data: unknown, chainId: string): RemoteFile[] {
  if (!Array.isArray(data)) throw new Error("Victory API format changed: expected array");
  return data.flatMap((row: unknown) => {
    if (!row || typeof row !== "object" || !("fileName" in row) || typeof row.fileName !== "string") return [];
    const name = row.fileName;
    if (!/^[\w.-]+\.(gz|xml)$/i.test(name)) return [];
    const p = parseFileName(name);
    if (p.kind === "unknown" || p.chainId !== chainId) return [];
    return [{ chainKey: "victory", name, ...p, ref: `${VICTORY_BASE}/webapi/${chainId}/${encodeURIComponent(name)}` }];
  });
}

export function victoryMirrorZipUrls(data: unknown): string[] {
  if (!data || typeof data !== "object" || !("resources" in data) || !Array.isArray(data.resources))
    throw new Error("Victory mirror version format changed");
  const urls = data.resources.flatMap((r: unknown) => {
    if (!r || typeof r !== "object" || !("format" in r) || r.format !== "ZIP") return [];
    if (!("download_url" in r) || typeof r.download_url !== "string") throw new Error("Missing Victory ZIP URL");
    const u = new URL(r.download_url);
    if (u.protocol !== "https:" || u.hostname !== MIRROR_HOST || !u.pathname.startsWith(MIRROR_PREFIX) || !u.pathname.endsWith(".zip") || u.username || u.password)
      throw new Error("Foreign Victory mirror ZIP URL");
    return [u.href];
  });
  if (!urls.length) throw new Error("Victory mirror has no raw-file ZIP");
  return [...new Set(urls)];
}

/** Uses archived original XML/gzip files, never the mirror's normalized price tables. */
export class VictorySource implements ChainSource {
  key = "victory";
  name = "ויקטורי";
  private payloads = new Map<string, Buffer>();
  constructor(private http: HttpOptions, private route: "mirror" | "direct" = "mirror") {}

  async listFiles(kinds: FileKind[], storeIds?: string[]): Promise<RemoteFile[]> {
    if (this.route === "direct") {
      const chainId = VICTORY_CHAIN_IDS[0];
      const res = await fetchWithRetry(`${VICTORY_BASE}/webapi/api/getfiles?edi=${chainId}`, { opts: this.http });
      if (!res.ok) throw new Error(`Victory listing HTTP ${res.status}`);
      return extractVictoryFiles(await res.json(), chainId).filter(f => kinds.includes(f.kind));
    }
    this.payloads.clear();
    const res = await fetchWithRetry(VICTORY_MIRROR_LATEST, { opts: this.http, headers: MIRROR_HEADERS });
    if (!res.ok) throw new Error(`Victory mirror metadata HTTP ${res.status}`);
    const out = new Map<string, RemoteFile>();
    for (const url of victoryMirrorZipUrls(await res.json())) {
      const zip = await getBuffer(url, { ...this.http, timeoutMs: 90_000 }, MIRROR_HEADERS);
      // Filter before decompression: retain only requested official Victory files.
      const entries = unzipSync(zip, { filter: entry => {
        const name = entry.name.split("/").at(-1)!;
        if (!/^[\w.-]+\.(gz|xml)$/i.test(name)) return false;
        const p = parseFileName(name);
        return p.chainId === VICTORY_CHAIN_IDS[0] && kinds.includes(p.kind);
      } });
      for (const [path, bytes] of Object.entries(entries)) {
        const name = path.split("/").at(-1)!;
        const p = parseFileName(name);
        const ref = `victory-mirror:${name}`;
        this.payloads.set(ref, Buffer.from(bytes));
        out.set(name, { chainKey: this.key, name, ...p, ref });
      }
    }
    if (!out.size) throw new Error("Victory mirror ZIP contains no requested official files");
    return [...out.values()].filter(f => f.kind === "stores" || !storeIds || (f.storeId && storeIds.some(id => Number(id) === Number(f.storeId))));
  }

  download(file: RemoteFile): Promise<Buffer> {
    if (file.chainKey !== this.key || file.chainId !== VICTORY_CHAIN_IDS[0]) throw new Error("Foreign Victory download");
    const cached = this.payloads.get(file.ref);
    if (cached) return Promise.resolve(cached);
    if (this.route !== "direct") throw new Error("Victory mirror file not in current listing");
    const url = new URL(file.ref);
    if (url.origin !== VICTORY_BASE || !url.pathname.startsWith(`/webapi/${VICTORY_CHAIN_IDS[0]}/`)) throw new Error("Foreign Victory download");
    return getBuffer(file.ref, this.http);
  }
}
