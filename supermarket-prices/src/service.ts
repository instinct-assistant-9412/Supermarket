import type { BasketStoreResult, HistoryPoint, ProductRow, Repository, SearchHit, StoreArea } from "./ingest/repository.js";

export interface BasketItemInput {
  gtin?: string;
  query?: string;
  qty?: number;
}

export interface BasketAnswer {
  resolved: Array<{ input: BasketItemInput; product: ProductRow | null; note?: string }>;
  stores: BasketStoreResult[];
  /** true when every resolved product is priced in the stores listed first */
  complete: boolean;
}

/** Shared by the HTTP API and the MCP server, so both answer identically. */
export class PriceService {
  constructor(private repo: Repository) {}

  searchProducts(q: string, limit = 20): Promise<SearchHit[]> {
    return this.repo.searchProducts(q, Math.min(Math.max(limit, 1), 100));
  }

  async resolveProduct(ref: { id?: number; gtin?: string; query?: string }): Promise<ProductRow | null> {
    if (ref.id !== undefined) return this.repo.getProduct(ref.id);
    if (ref.gtin) return this.repo.getProductByGtin(ref.gtin);
    if (ref.query) return (await this.repo.searchProducts(ref.query, 1))[0] ?? null;
    return null;
  }

  async priceHistory(ref: { id?: number; gtin?: string; query?: string }, opts: { chainId?: string; storeKey?: string; days?: number }) {
    const product = await this.resolveProduct(ref);
    if (!product) return null;
    const since = opts.days ? new Date(Date.now() - opts.days * 86400_000) : undefined;
    const points: HistoryPoint[] = await this.repo.priceHistory(product.id, { chainId: opts.chainId, storeKey: opts.storeKey, since });
    return { product, points };
  }

  /**
   * "Cheapest basket in area X". Stores that carry every resolved item come first (cheapest first);
   * with requireAll=false stores with partial coverage follow, and their missing items are listed.
   */
  async cheapestBasket(items: BasketItemInput[], area: StoreArea, opts: { limit?: number; requireAll?: boolean } = {}): Promise<BasketAnswer> {
    const resolved: BasketAnswer["resolved"] = [];
    const lines: Array<{ productId: number; qty: number }> = [];
    for (const input of items) {
      const product = await this.resolveProduct({ gtin: input.gtin, query: input.query });
      if (!product) {
        resolved.push({ input, product: null, note: "לא נמצא מוצר תואם" });
        continue;
      }
      const qty = input.qty && input.qty > 0 ? input.qty : 1;
      const existing = lines.find((l) => l.productId === product.id);
      if (existing) existing.qty += qty;
      else lines.push({ productId: product.id, qty });
      resolved.push({ input, product });
    }
    const requireAll = opts.requireAll ?? true;
    const stores = await this.repo.basket(lines, area, opts.limit ?? 10, requireAll);
    return { resolved, stores, complete: stores.length > 0 && stores[0]!.missingProductIds.length === 0 };
  }

  listStores(opts: { text?: string; chainIds?: string[]; online?: boolean; limit?: number }) {
    return this.repo.listStores({ ...opts, limit: Math.min(Math.max(opts.limit ?? 50, 1), 200) });
  }

  freshness() {
    return this.repo.freshness();
  }

  reviewQueue(limit = 50) {
    return this.repo.reviewQueue(limit);
  }
}
