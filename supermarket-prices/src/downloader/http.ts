export interface HttpOptions {
  userAgent: string;
  retries?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url: string, init: RequestInit & { opts: HttpOptions }): Promise<Response> {
  const { opts, ...rest } = init;
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        headers: { "user-agent": opts.userAgent, ...(rest.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getBuffer(url: string, opts: HttpOptions, headers?: Record<string, string>): Promise<Buffer> {
  const res = await fetchWithRetry(url, { opts, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Minimal cookie jar: enough for the session cookie of the publishedprices portal. */
export class CookieJar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair!.indexOf("=");
      if (i > 0) this.jar.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim());
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
