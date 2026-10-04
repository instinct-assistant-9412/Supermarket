import type { Config } from "../config.js";
import { matchItem } from "../normalize/matcher.js";
import { checkFile } from "../quality/checks.js";
import { parsePriceFile, parseStoresFile } from "../parser/priceFile.js";
import type { ChainSource, FileKind, PriceFile, RemoteFile } from "../types.js";
import type { IngestRunInfo, PriceWrite, Repository } from "./repository.js";

export interface IngestOptions {
  config: Pick<Config, "fuzzyAutoThreshold" | "fuzzyReviewThreshold" | "maxPriceIls" | "maxFileAgeHours">;
  now?: () => Date;
}

/** Stores one parsed price file: match products, write current prices + history, run quality checks. */
export async function ingestPriceFile(
  repo: Repository,
  file: PriceFile,
  meta: { fileName: string; fileTime: Date | null; expectedChainId: string | null; chainName?: string | null },
  opts: IngestOptions,
): Promise<IngestRunInfo> {
  const now = opts.now?.() ?? new Date();
  const chainId = file.chainId || meta.expectedChainId || "unknown";
  if (meta.expectedChainId && file.chainId && meta.expectedChainId !== file.chainId) {
    // wrong chain inside the file: do not write anything, just record the failure
    const bad: IngestRunInfo = {
      chainId, storeId: `${file.subChainId}-${file.storeId}`, fileName: meta.fileName, fileTime: meta.fileTime,
      itemsTotal: 0, itemsInvalid: file.items.length + file.skipped, gtinMatched: 0, fuzzyMatched: 0, newProducts: 0,
      needsReview: 0, priceChanges: 0, status: "failed",
      issues: [`CHAIN_MISMATCH: ChainId בקובץ (${file.chainId}) שונה מהצפוי (${meta.expectedChainId})`],
    };
    await repo.recordIngestRun(bad);
    return bad;
  }
  await repo.upsertChain(chainId, meta.chainName ?? null);
  const storeKey = await repo.ensureStore(chainId, file.subChainId, file.storeId);
  const prev = await repo.previousRun(chainId, `${file.subChainId}-${file.storeId}`);

  const seen = new Set<string>();
  let duplicates = 0;
  let invalid = file.skipped;
  let gtinMatched = 0;
  let fuzzyMatched = 0;
  let newProducts = 0;
  let needsReview = 0;
  const prices: PriceWrite[] = [];

  for (const item of file.items) {
    if (seen.has(item.itemCode)) {
      duplicates++;
      continue;
    }
    seen.add(item.itemCode);
    if (!(item.price > 0) || item.price > opts.config.maxPriceIls) {
      invalid++;
      continue;
    }
    const m = await matchItem(repo, chainId, item, { auto: opts.config.fuzzyAutoThreshold, review: opts.config.fuzzyReviewThreshold });
    if (m.method === "gtin") gtinMatched++;
    else if (m.method === "fuzzy") fuzzyMatched++;
    else if (m.method === "new") newProducts++;
    if (m.needsReview) needsReview++;
    await repo.upsertChainItem({
      chainId, itemCode: item.itemCode, productId: m.productId, rawName: item.name, matchMethod: m.method,
      matchScore: m.score, needsReview: m.needsReview, manufacturer: item.manufacturer,
    });
    prices.push({ itemCode: item.itemCode, price: item.price, unitPrice: item.unitPrice, priceUpdatedAt: item.priceUpdatedAt });
  }

  const written = await repo.recordPrices(chainId, storeKey, prices, meta.fileTime ?? now);
  const issues = checkFile(
    { expectedChainId: meta.expectedChainId, fileChainId: file.chainId, itemsTotal: prices.length, itemsInvalid: invalid, duplicates, gtinMatched, fileTime: meta.fileTime },
    prev, opts.config, now,
  );
  const run: IngestRunInfo = {
    chainId, storeId: `${file.subChainId}-${file.storeId}`, fileName: meta.fileName, fileTime: meta.fileTime,
    itemsTotal: prices.length, itemsInvalid: invalid, gtinMatched, fuzzyMatched, newProducts, needsReview,
    priceChanges: written.changed,
    status: issues.some((i) => i.severity === "error") ? "failed" : issues.length ? "warning" : "ok",
    issues: issues.map((i) => `${i.code}: ${i.message}`),
  };
  await repo.recordIngestRun(run);
  return run;
}

export interface SourceIngestSummary {
  source: string;
  filesSeen: number;
  filesIngested: number;
  filesSkipped: number;
  failures: Array<{ file: string; error: string }>;
  runs: IngestRunInfo[];
}

/** Keeps only the newest file per store (for price kinds). */
export function latestPerStore(files: RemoteFile[]): RemoteFile[] {
  const best = new Map<string, RemoteFile>();
  for (const f of files) {
    const key = `${f.kind}:${f.chainId}:${f.subChainId}:${f.storeId}`;
    const cur = best.get(key);
    if (!cur || (f.publishedAt?.getTime() ?? 0) > (cur.publishedAt?.getTime() ?? 0)) best.set(key, f);
  }
  return [...best.values()];
}

export async function ingestSource(
  repo: Repository,
  source: ChainSource,
  opts: IngestOptions & { kinds?: FileKind[]; maxFiles?: number; expectedChainId?: string | null },
): Promise<SourceIngestSummary> {
  const kinds = opts.kinds ?? ["pricefull"];
  const summary: SourceIngestSummary = { source: source.key, filesSeen: 0, filesIngested: 0, filesSkipped: 0, failures: [], runs: [] };
  const listed = await source.listFiles([...kinds, "stores"]);
  summary.filesSeen = listed.length;

  const storeFiles = latestPerStore(listed.filter((f) => f.kind === "stores"));
  for (const sf of storeFiles) {
    try {
      const stores = parseStoresFile(await source.download(sf));
      await repo.upsertChain(stores[0]?.chainId ?? sf.chainId ?? source.key, source.name);
      await repo.upsertStores(stores);
    } catch (e) {
      summary.failures.push({ file: sf.name, error: (e as Error).message });
    }
  }

  let priceFiles = latestPerStore(listed.filter((f) => kinds.includes(f.kind)));
  if (opts.maxFiles) priceFiles = priceFiles.slice(0, opts.maxFiles);
  for (const f of priceFiles) {
    if (await repo.hasIngestedFile(f.name)) {
      summary.filesSkipped++;
      continue;
    }
    try {
      const parsed = parsePriceFile(await source.download(f));
      const run = await ingestPriceFile(repo, parsed, { fileName: f.name, fileTime: f.publishedAt, expectedChainId: opts.expectedChainId ?? f.chainId, chainName: source.name }, opts);
      summary.runs.push(run);
      summary.filesIngested++;
    } catch (e) {
      summary.failures.push({ file: f.name, error: (e as Error).message });
    }
  }
  return summary;
}
