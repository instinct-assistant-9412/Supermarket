import type pg from "pg";
import type { StoreRecord } from "../types.js";
import { normalizeHebrew } from "../normalize/hebrew.js";
import type {
  BasketLine, BasketStoreResult, ChainItemRow, FreshnessRow, HistoryPoint, IngestRunInfo, PriceWrite,
  ProductRow, Repository, SearchHit, SimilarProduct, StoreArea, WriteResult,
} from "../ingest/repository.js";

type Row = Record<string, any>;

const productFrom = (r: Row): ProductRow => ({ id: r.id, gtin: r.gtin, name: r.name, nameNorm: r.name_norm, sizeKey: r.size_key });
const searchText = (s: { name: string | null; address: string | null; city: string | null }) =>
  normalizeHebrew([s.city, s.address, s.name].filter(Boolean).join(" "));

export class PgRepository implements Repository {
  constructor(private pool: pg.Pool) {}

  async upsertChain(chainId: string, name: string | null) {
    await this.pool.query(
      `INSERT INTO chains (chain_id, name) VALUES ($1, $2)
       ON CONFLICT (chain_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, chains.name), updated_at = now()`,
      [chainId, name],
    );
  }

  async upsertStores(stores: StoreRecord[]) {
    for (const s of stores) {
      await this.upsertChain(s.chainId, null);
      await this.pool.query(
        `INSERT INTO stores (chain_id, sub_chain_id, store_id, name, address, city, zip, search_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (chain_id, sub_chain_id, store_id)
         DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city,
                       zip = EXCLUDED.zip, search_text = EXCLUDED.search_text`,
        [s.chainId, s.subChainId, s.storeId, s.name, s.address, s.city, s.zip, searchText(s)],
      );
    }
  }

  async ensureStore(chainId: string, sub: string, storeId: string): Promise<string> {
    const r = await this.pool.query(
      `INSERT INTO stores (chain_id, sub_chain_id, store_id) VALUES ($1,$2,$3)
       ON CONFLICT (chain_id, sub_chain_id, store_id) DO UPDATE SET chain_id = EXCLUDED.chain_id
       RETURNING id`,
      [chainId, sub, storeId],
    );
    return String(r.rows[0].id);
  }

  async getChainItem(chainId: string, itemCode: string): Promise<ChainItemRow | null> {
    const r = await this.pool.query(`SELECT * FROM chain_items WHERE chain_id=$1 AND item_code=$2`, [chainId, itemCode]);
    const x = r.rows[0];
    return x ? { chainId: x.chain_id, itemCode: x.item_code, productId: x.product_id, rawName: x.raw_name, matchMethod: x.match_method, matchScore: x.match_score, needsReview: x.needs_review } : null;
  }

  async findProductByGtin(gtin: string) {
    const r = await this.pool.query(`SELECT * FROM products WHERE gtin=$1`, [gtin]);
    return r.rows[0] ? productFrom(r.rows[0]) : null;
  }

  async findSimilarProducts(nameNorm: string, min: number, limit: number): Promise<SimilarProduct[]> {
    // `%` uses the GIN trigram index (default pg_trgm.similarity_threshold = 0.3); the exact cut is applied after
    const r = await this.pool.query(
      `SELECT *, similarity(name_norm, $1) AS sim FROM products
       WHERE name_norm % $1 AND similarity(name_norm, $1) >= $2
       ORDER BY sim DESC LIMIT $3`,
      [nameNorm, min, limit],
    );
    return r.rows.map((x) => ({ ...productFrom(x), similarity: Number(x.sim) }));
  }

  async createProduct(p: { gtin: string | null; name: string; nameNorm: string; sizeKey: string | null }) {
    const r = await this.pool.query(
      `INSERT INTO products (gtin, name, name_norm, size_key) VALUES ($1,$2,$3,$4)
       ON CONFLICT (gtin) DO UPDATE SET gtin = EXCLUDED.gtin RETURNING *`,
      [p.gtin, p.name, p.nameNorm, p.sizeKey],
    );
    return productFrom(r.rows[0]);
  }

  async upsertChainItem(row: ChainItemRow & { manufacturer: string | null }) {
    await this.pool.query(
      `INSERT INTO chain_items (chain_id, item_code, product_id, raw_name, manufacturer, match_method, match_score, needs_review)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (chain_id, item_code) DO UPDATE SET product_id = EXCLUDED.product_id, raw_name = EXCLUDED.raw_name,
         manufacturer = EXCLUDED.manufacturer, match_method = EXCLUDED.match_method, match_score = EXCLUDED.match_score,
         needs_review = EXCLUDED.needs_review, updated_at = now()`,
      [row.chainId, row.itemCode, row.productId, row.rawName, row.manufacturer, row.matchMethod, row.matchScore, row.needsReview],
    );
  }

  async recordPrices(chainId: string, storeKey: string, prices: PriceWrite[], observedAt: Date): Promise<WriteResult> {
    const res: WriteResult = { inserted: 0, changed: 0, unchanged: 0 };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const p of prices) {
        const cur = await client.query(`SELECT price FROM current_prices WHERE store_pk=$1 AND item_code=$2`, [storeKey, p.itemCode]);
        const prev = cur.rows[0] ? Number(cur.rows[0].price) : null;
        if (prev === null) res.inserted++;
        else if (prev !== p.price) res.changed++;
        else res.unchanged++;
        if (prev === null || prev !== p.price) {
          await client.query(
            `INSERT INTO price_history (store_pk, chain_id, item_code, price, valid_from) VALUES ($1,$2,$3,$4,$5)`,
            [storeKey, chainId, p.itemCode, p.price, observedAt],
          );
        }
        await client.query(
          `INSERT INTO current_prices (store_pk, chain_id, item_code, price, unit_price, price_updated_at, observed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (store_pk, item_code) DO UPDATE SET price = EXCLUDED.price, unit_price = EXCLUDED.unit_price,
             price_updated_at = EXCLUDED.price_updated_at, observed_at = EXCLUDED.observed_at`,
          [storeKey, chainId, p.itemCode, p.price, p.unitPrice, p.priceUpdatedAt, observedAt],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    return res;
  }

  async hasIngestedFile(fileName: string) {
    const r = await this.pool.query(`SELECT 1 FROM ingest_runs WHERE file_name=$1 AND status <> 'failed' LIMIT 1`, [fileName]);
    return r.rowCount! > 0;
  }

  async recordIngestRun(r: IngestRunInfo) {
    await this.pool.query(
      `INSERT INTO ingest_runs (chain_id, store_id, file_name, file_time, items_total, items_invalid, gtin_matched,
         fuzzy_matched, new_products, needs_review, price_changes, status, issues)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.chainId, r.storeId, r.fileName, r.fileTime, r.itemsTotal, r.itemsInvalid, r.gtinMatched, r.fuzzyMatched, r.newProducts, r.needsReview, r.priceChanges, r.status, r.issues],
    );
  }

  async previousRun(chainId: string, storeId: string): Promise<IngestRunInfo | null> {
    const r = await this.pool.query(
      `SELECT * FROM ingest_runs WHERE chain_id=$1 AND store_id=$2 AND status <> 'failed' ORDER BY created_at DESC LIMIT 1`,
      [chainId, storeId],
    );
    const x = r.rows[0];
    if (!x) return null;
    return {
      chainId: x.chain_id, storeId: x.store_id, fileName: x.file_name, fileTime: x.file_time, itemsTotal: x.items_total,
      itemsInvalid: x.items_invalid, gtinMatched: x.gtin_matched, fuzzyMatched: x.fuzzy_matched, newProducts: x.new_products,
      needsReview: x.needs_review, priceChanges: x.price_changes, status: x.status, issues: x.issues,
    };
  }

  async getProduct(id: number) {
    const r = await this.pool.query(`SELECT * FROM products WHERE id=$1`, [id]);
    return r.rows[0] ? productFrom(r.rows[0]) : null;
  }

  async getProductByGtin(gtin: string) {
    return this.findProductByGtin(gtin.replace(/\D/g, "").padStart(13, "0"));
  }

  async searchProducts(query: string, limit: number): Promise<SearchHit[]> {
    const q = normalizeHebrew(query);
    const r = await this.pool.query(
      `SELECT p.*, GREATEST(similarity(p.name_norm, $1), CASE WHEN p.name_norm LIKE '%' || $1 || '%' THEN 0.9 ELSE 0 END) AS score,
              agg.min_price, agg.max_price, COALESCE(agg.chains, 0) AS chains
       FROM products p
       LEFT JOIN LATERAL (
         SELECT min(cp.price) AS min_price, max(cp.price) AS max_price, count(DISTINCT cp.chain_id) AS chains
         FROM chain_items ci JOIN current_prices cp ON cp.chain_id = ci.chain_id AND cp.item_code = ci.item_code
         WHERE ci.product_id = p.id) agg ON true
       WHERE p.name_norm % $1 OR p.name_norm LIKE '%' || $1 || '%'
       ORDER BY score DESC, chains DESC LIMIT $2`,
      [q, limit],
    );
    return r.rows.map((x) => ({
      ...productFrom(x), score: Number(x.score),
      minPrice: x.min_price === null ? null : Number(x.min_price),
      maxPrice: x.max_price === null ? null : Number(x.max_price),
      chains: Number(x.chains),
    }));
  }

  async priceHistory(productId: number, opts: { chainId?: string; storeKey?: string; since?: Date }): Promise<HistoryPoint[]> {
    const r = await this.pool.query(
      `SELECT h.chain_id, h.store_pk, h.price, h.valid_from
       FROM price_history h JOIN chain_items ci ON ci.chain_id = h.chain_id AND ci.item_code = h.item_code
       WHERE ci.product_id = $1
         AND ($2::text IS NULL OR h.chain_id = $2)
         AND ($3::int IS NULL OR h.store_pk = $3)
         AND ($4::timestamptz IS NULL OR h.valid_from >= $4)
       ORDER BY h.valid_from`,
      [productId, opts.chainId ?? null, opts.storeKey ?? null, opts.since ?? null],
    );
    return r.rows.map((x) => ({ chainId: x.chain_id, storeKey: String(x.store_pk), price: Number(x.price), validFrom: x.valid_from }));
  }

  async basket(lines: BasketLine[], area: StoreArea, limit: number, requireAll: boolean): Promise<BasketStoreResult[]> {
    if (lines.length === 0) return [];
    const ids = lines.map((l) => l.productId);
    const qtys = lines.map((l) => l.qty);
    const r = await this.pool.query(
      `WITH want AS (SELECT * FROM unnest($1::int[], $2::numeric[]) AS w(product_id, qty)),
       best AS (  -- cheapest price per store and product (a product can have several chain codes)
         SELECT cp.store_pk, ci.product_id, min(cp.price) AS price
         FROM current_prices cp
         JOIN chain_items ci ON ci.chain_id = cp.chain_id AND ci.item_code = cp.item_code
         WHERE ci.product_id = ANY($1::int[])
         GROUP BY cp.store_pk, ci.product_id)
       SELECT s.id, s.chain_id, c.name AS chain_name, s.name, s.address, s.city,
              sum(b.price * w.qty) AS total, count(*) AS found,
              ARRAY(SELECT w2.product_id FROM want w2 WHERE NOT EXISTS
                (SELECT 1 FROM best b2 WHERE b2.store_pk = s.id AND b2.product_id = w2.product_id)) AS missing
       FROM best b JOIN want w ON w.product_id = b.product_id
       JOIN stores s ON s.id = b.store_pk LEFT JOIN chains c ON c.chain_id = s.chain_id
       WHERE ($3::text IS NULL OR s.search_text LIKE '%' || $3 || '%')
         AND ($4::text[] IS NULL OR s.chain_id = ANY($4))
         AND ($5::int[] IS NULL OR s.id = ANY($5))
       GROUP BY s.id, s.chain_id, c.name
       HAVING ($6::boolean = false OR count(*) = $7)
       ORDER BY count(*) DESC, sum(b.price * w.qty) ASC
       LIMIT $8`,
      [ids, qtys, area.text ? normalizeHebrew(area.text) : null, area.chainIds?.length ? area.chainIds : null,
       area.storeKeys?.length ? area.storeKeys.map(Number) : null, requireAll, lines.length, limit],
    );
    return r.rows.map((x) => ({
      chainId: x.chain_id, chainName: x.chain_name, storeKey: String(x.id), storeName: x.name, address: x.address,
      city: x.city, total: Math.round(Number(x.total) * 100) / 100, found: Number(x.found), missingProductIds: x.missing,
    }));
  }

  async freshness(): Promise<FreshnessRow[]> {
    const r = await this.pool.query(
      `SELECT c.chain_id, c.name,
              (SELECT count(DISTINCT store_pk) FROM current_prices cp WHERE cp.chain_id = c.chain_id) AS stores,
              (SELECT count(*) FROM current_prices cp WHERE cp.chain_id = c.chain_id) AS current_prices,
              (SELECT max(file_time) FROM ingest_runs ir WHERE ir.chain_id = c.chain_id AND ir.status <> 'failed') AS last_file_time,
              (SELECT max(created_at) FROM ingest_runs ir WHERE ir.chain_id = c.chain_id) AS last_ingest_at
       FROM chains c ORDER BY c.chain_id`,
    );
    return r.rows.map((x) => ({
      chainId: x.chain_id, chainName: x.name, stores: Number(x.stores), currentPrices: Number(x.current_prices),
      lastFileTime: x.last_file_time, lastIngestAt: x.last_ingest_at,
    }));
  }

  async reviewQueue(limit: number) {
    const r = await this.pool.query(
      `SELECT ci.*, p.name AS product_name FROM chain_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.needs_review ORDER BY ci.updated_at DESC LIMIT $1`, [limit]);
    return r.rows.map((x) => ({
      chainId: x.chain_id, itemCode: x.item_code, productId: x.product_id, rawName: x.raw_name, matchMethod: x.match_method,
      matchScore: x.match_score, needsReview: x.needs_review, productName: x.product_name,
    }));
  }
}
