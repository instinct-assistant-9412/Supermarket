import type { ChainSource, FileKind, RemoteFile } from "../types.js";
import { parseFileName } from "./fileName.js";
import { CookieJar, fetchWithRetry, type HttpOptions } from "./http.js";

const BASE = "https://url.publishedprices.co.il";

export interface PublishedPricesChain {
  key: string;
  name: string;
  /** Login user of the chain on the portal. Empty password. */
  username: string;
}

/**
 * Many chains publish through the same Cerberus FTP web portal (url.publishedprices.co.il),
 * each with its own username and an empty password.
 * Flow verified live with one chain: GET /login (csrf in <meta name="csrftoken">) ->
 * POST /login/user (302 to /file) -> POST /file/json/dir (DataTables JSON, "aaData") -> GET /file/d/<name>.
 * Which usernames belong to which chain is NOT verified for most chains (README).
 */
export class PublishedPricesSource implements ChainSource {
  key: string;
  name: string;
  private jar = new CookieJar();
  private loggedIn = false;

  constructor(private chain: PublishedPricesChain, private http: HttpOptions, private password = "") {
    this.key = chain.key;
    this.name = chain.name;
  }

  private async csrf(path: string): Promise<string> {
    const res = await fetchWithRetry(`${BASE}${path}`, { opts: this.http, headers: { cookie: this.jar.header() } });
    this.jar.absorb(res);
    const html = await res.text();
    const token = html.match(/name="csrftoken"\s+content="([^"]+)"/)?.[1];
    if (!token) throw new Error("csrftoken not found on " + path);
    return token;
  }

  private async login(): Promise<void> {
    const token = await this.csrf("/login");
    const body = new URLSearchParams({ username: this.chain.username, password: this.password, r: "", csrftoken: token });
    const res = await fetchWithRetry(`${BASE}/login/user`, {
      opts: this.http,
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: this.jar.header() },
      body,
    });
    this.jar.absorb(res);
    if (res.status !== 302) throw new Error(`login failed for ${this.chain.username} (HTTP ${res.status})`);
    this.loggedIn = true;
  }

  async listFiles(kinds: FileKind[]): Promise<RemoteFile[]> {
    if (!this.loggedIn) await this.login();
    const token = await this.csrf("/file");
    const body = new URLSearchParams({ iDisplayStart: "0", iDisplayLength: "100000", cd: "/", csrftoken: token });
    const res = await fetchWithRetry(`${BASE}/file/json/dir`, {
      opts: this.http,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: this.jar.header() },
      body,
    });
    this.jar.absorb(res);
    const json = (await res.json()) as { aaData?: Array<{ fname: string; time?: string; type?: string }> };
    const files: RemoteFile[] = [];
    for (const row of json.aaData ?? []) {
      if (row.type && row.type !== "file") continue;
      const p = parseFileName(row.fname);
      if (!kinds.includes(p.kind)) continue;
      files.push({
        chainKey: this.key, name: row.fname, kind: p.kind, chainId: p.chainId, subChainId: p.subChainId,
        storeId: p.storeId, publishedAt: p.publishedAt ?? (row.time ? new Date(row.time) : null), ref: row.fname,
      });
    }
    return files;
  }

  async download(file: RemoteFile): Promise<Buffer> {
    if (!this.loggedIn) await this.login();
    const res = await fetchWithRetry(`${BASE}/file/d/${encodeURIComponent(file.ref)}`, { opts: this.http, headers: { cookie: this.jar.header() } });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${file.ref}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
