import type { ChainSource, FileKind, RemoteFile } from "../types.js";
import { parseFileName } from "./fileName.js";
import { fetchWithRetry, getBuffer, type HttpOptions } from "./http.js";

export const VICTORY_BASE = "https://laibcatalog.co.il";
export const VICTORY_CHAIN_IDS = ["7290696200003", "7290058103393"] as const;

/** New Laibcatalog API. Each file is bound to its own chain, never the first chain in a list. */
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

/** API contract researched publicly; see README for live verification status. */
export class VictorySource implements ChainSource {
  key = "victory";
  name = "ויקטורי";
  constructor(private http: HttpOptions) {}
  async listFiles(kinds: FileKind[]): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    for (const chainId of VICTORY_CHAIN_IDS) {
      const branches = await fetchWithRetry(`${VICTORY_BASE}/webapi/api/getbranches?edi=${chainId}`, { opts: this.http });
      if (!branches.ok) throw new Error(`Victory branches HTTP ${branches.status} (${chainId})`);
      const branchData: unknown = await branches.json();
      if (!Array.isArray(branchData)) throw new Error("Victory branches format changed");
      // The API returns HTTP 400 for chain IDs with no active root. Do not list these.
      if (branchData.length === 0) continue;
      const res = await fetchWithRetry(`${VICTORY_BASE}/webapi/api/getfiles?edi=${chainId}`, { opts: this.http });
      if (!res.ok) throw new Error(`Victory listing HTTP ${res.status} (${chainId})`);
      out.push(...extractVictoryFiles(await res.json(), chainId).filter((f) => kinds.includes(f.kind)));
    }
    return out;
  }
  download(file: RemoteFile): Promise<Buffer> {
    const url = new URL(file.ref);
    if (url.origin !== VICTORY_BASE || file.chainKey !== this.key || !VICTORY_CHAIN_IDS.some((id) => url.pathname.startsWith(`/webapi/${id}/`))) throw new Error("Foreign Victory download");
    return getBuffer(url.href, this.http);
  }
}
