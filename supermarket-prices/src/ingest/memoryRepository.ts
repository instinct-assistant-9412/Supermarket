import type { StoreRecord } from "../types.js";
import { normalizeHebrew } from "../normalize/hebrew.js";
import { similarity } from "../normalize/trigram.js";
import type {
  BasketLine, BasketStoreResult, ChainItemRow, FreshnessRow, HistoryPoint, IngestRunInfo, PriceWrite,
  ProductRow, Repository, SearchHit, SimilarProduct, StoreArea, StoreListRow, WriteResult,
} from "./repository.js";

interface StoreMem extends StoreRecord {
  key: string;
}
interface CurrentMem {
  chainId: string;
  storeKey: string;
  itemCode: string;
  price: number;
  unitPrice: number | null;
  observedAt: Date;
}

/** In-memory Repository used by the tests and for quick local experiments. Same contract as PgRepository. */
export class MemoryRepository implements Repository {
  chains = new Map<string, string | null>();
  stores = new Map<string, StoreMem>();
  products: ProductRow[] = [];
  chainItems = new Map<string, ChainItemRow>();
  current = new Map<string, CurrentMem>();
  history: Array<{ chainId: string; storeKey: string; itemCode: string; price: number; validFrom: Date }> = [];
  runs: Array<IngestRunInfo & { at: Date }> = [];
  private nextId = 1;

  async upsertChain(chainId: string, name: string | null) {
    if (!this.chains.has(chainId) || name) this.chains.set(chainId, name ?? this.chains.get(chainId) ?? null);
  }
  private key(chainId: string, sub: string, store: string) {
    return `${chainId}:${sub}:${store}`;
  }
  async upsertStores(stores: StoreRecord[]) {
    for (const s of stores) this.stores.set(this.key(s.chainId, s.subChainId, s.storeId), { ...s, key: this.key(s.chainId, s.subChainId, s.storeId) });
  }
  async ensureStore(chainId: string, sub: string, storeId: string) {
    const k = this.key(chainId, sub, storeId);
    if (!this.stores.has(k)) this.stores.set(k, { chainId, subChainId: sub, storeId, name: null, address: null, city: null, zip: null, isOnline: false, key: k });
    return k;
  }
  async getChainItem(chainId: string, itemCode: string) {
    return this.chainItems.get(`${chainId}:${itemCode}`) ?? null;
  }
  async findProductByGtin(gtin: string) {
    return this.products.find((p) => p.gtin === gtin) ?? null;
  }
  async findSimilarProducts(nameNorm: string, min: number, limit: number): Promise<SimilarProduct[]> {
    return this.products
      .map((p) => ({ ...p, similarity: similarity(nameNorm, p.nameNorm) }))
      .filter((p) => p.similarity >= min)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
  async createProduct(p: { gtin: string | null; name: string; nameNorm: string; sizeKey: string | null }) {
    const row: ProductRow = { id: this.nextId++, ...p };
    this.products.push(row);
    return row;
  }
  async upsertChainItem(row: ChainItemRow & { manufacturer: string | null }) {
    const { manufacturer: _m, ...rest } = row;
    this.chainItems.set(`${row.chainId}:${row.itemCode}`, rest);
  }
  async recordPrices(chainId: string, storeKey: string, prices: PriceWrite[], observedAt: Date): Promise<WriteResult> {
    const r: WriteResult = { inserted: 0, changed: 0, unchanged: 0 };
    for (const p of prices) {
      const k = `${storeKey}:${p.itemCode}`;
      const cur = this.current.get(k);
      if (!cur) {
        r.inserted++;
        this.history.push({ chainId, storeKey, itemCode: p.itemCode, price: p.price, validFrom: observedAt });
      } else if (cur.price !== p.price) {
        r.changed++;
        this.history.push({ chainId, storeKey, itemCode: p.itemCode, price: p.price, validFrom: observedAt });
      } else r.unchanged++;
      this.current.set(k, { chainId, storeKey, itemCode: p.itemCode, price: p.price, unitPrice: p.unitPrice, observedAt });
    }
    return r;
  }
  async hasIngestedFile(fileName: string) {
    return this.runs.some((r) => r.fileName === fileName && r.status !== "failed");
  }
  async recordIngestRun(run: IngestRunInfo) {
    this.runs.push({ ...run, at: new Date() });
  }
  async previousRun(chainId: string, storeId: string) {
    const rs = this.runs.filter((r) => r.chainId === chainId && r.storeId === storeId && r.status !== "failed");
    return rs[rs.length - 1] ?? null;
  }

  private productOf(chainId: string, itemCode: string) {
    return this.chainItems.get(`${chainId}:${itemCode}`)?.productId ?? null;
  }
  async getProduct(id: number) {
    return this.products.find((p) => p.id === id) ?? null;
  }
  async getProductByGtin(gtin: string) {
    return this.findProductByGtin(gtin.replace(/\D/g, "").padStart(13, "0"));
  }
  async searchProducts(query: string, limit: number): Promise<SearchHit[]> {
    const q = normalizeHebrew(query);
    const hits: SearchHit[] = [];
    for (const p of this.products) {
      const contains = q !== "" && p.nameNorm.includes(q);
      const score = Math.max(similarity(q, p.nameNorm), contains ? 0.9 : 0);
      if (score < 0.3 && !contains) continue;
      const prices = [...this.current.values()].filter((c) => this.productOf(c.chainId, c.itemCode) === p.id);
      hits.push({
        ...p,
        score,
        minPrice: prices.length ? Math.min(...prices.map((x) => x.price)) : null,
        maxPrice: prices.length ? Math.max(...prices.map((x) => x.price)) : null,
        chains: new Set(prices.map((x) => x.chainId)).size,
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  async priceHistory(productId: number, opts: { chainId?: string; storeKey?: string; since?: Date }): Promise<HistoryPoint[]> {
    return this.history
      .filter((h) => this.productOf(h.chainId, h.itemCode) === productId)
      .filter((h) => (opts.chainId ? h.chainId === opts.chainId : true))
      .filter((h) => (opts.storeKey ? h.storeKey === opts.storeKey : true))
      .filter((h) => (opts.since ? h.validFrom >= opts.since : true))
      .map((h) => ({ chainId: h.chainId, storeKey: h.storeKey, price: h.price, validFrom: h.validFrom }))
      .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
  }
  private inArea(s: StoreMem, area: StoreArea) {
    if (s.isOnline !== (area.online ?? false)) return false;
    if (area.chainIds?.length && !area.chainIds.includes(s.chainId)) return false;
    if (area.storeKeys?.length && !area.storeKeys.includes(s.key)) return false;
    if (area.text) {
      const hay = normalizeHebrew([s.city, s.address, s.name].filter(Boolean).join(" "));
      if (!hay.includes(normalizeHebrew(area.text))) return false;
    }
    return true;
  }
  async basket(lines: BasketLine[], area: StoreArea, limit: number, requireAll: boolean): Promise<BasketStoreResult[]> {
    const out: BasketStoreResult[] = [];
    for (const s of this.stores.values()) {
      if (!this.inArea(s, area)) continue;
      let total = 0;
      let found = 0;
      const missing: number[] = [];
      for (const line of lines) {
        const prices = [...this.current.values()]
          .filter((c) => c.storeKey === s.key && this.productOf(c.chainId, c.itemCode) === line.productId)
          .map((c) => c.price);
        if (prices.length === 0) missing.push(line.productId);
        else {
          total += Math.min(...prices) * line.qty;
          found++;
        }
      }
      if (found === 0 || (requireAll && missing.length)) continue;
      out.push({
        chainId: s.chainId, chainName: this.chains.get(s.chainId) ?? null, storeKey: s.key, storeName: s.name,
        address: s.address, city: s.city, isOnline: s.isOnline, total: Math.round(total * 100) / 100, found, missingProductIds: missing,
      });
    }
    return out.sort((a, b) => b.found - a.found || a.total - b.total).slice(0, limit);
  }
  async listStores(opts: { text?: string; chainIds?: string[]; online?: boolean; limit: number }): Promise<StoreListRow[]> {
    const out: StoreListRow[] = [];
    for (const s of this.stores.values()) {
      if (opts.online !== undefined && s.isOnline !== opts.online) continue;
      if (opts.chainIds?.length && !opts.chainIds.includes(s.chainId)) continue;
      if (opts.text && !normalizeHebrew([s.city, s.address, s.name].filter(Boolean).join(" ")).includes(normalizeHebrew(opts.text))) continue;
      out.push({ chainId: s.chainId, chainName: this.chains.get(s.chainId) ?? null, storeKey: s.key, storeName: s.name, address: s.address, city: s.city, isOnline: s.isOnline });
    }
    return out.sort((a, b) => a.chainId.localeCompare(b.chainId) || (a.storeName ?? "").localeCompare(b.storeName ?? "")).slice(0, opts.limit);
  }
  async freshness(): Promise<FreshnessRow[]> {
    return [...this.chains.entries()].map(([chainId, chainName]) => {
      const runs = this.runs.filter((r) => r.chainId === chainId);
      const times = runs.map((r) => r.fileTime?.getTime() ?? 0).filter(Boolean);
      return {
        chainId, chainName,
        stores: new Set([...this.current.values()].filter((c) => c.chainId === chainId).map((c) => c.storeKey)).size,
        currentPrices: [...this.current.values()].filter((c) => c.chainId === chainId).length,
        lastFileTime: times.length ? new Date(Math.max(...times)) : null,
        lastIngestAt: runs.length ? runs[runs.length - 1]!.at : null,
      };
    });
  }
  async reviewQueue(limit: number) {
    return [...this.chainItems.values()]
      .filter((c) => c.needsReview)
      .slice(0, limit)
      .map((c) => ({ ...c, productName: this.products.find((p) => p.id === c.productId)?.name ?? "" }));
  }
}
