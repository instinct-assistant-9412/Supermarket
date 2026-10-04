import type { PriceItem } from "../types.js";
import type { MatchMethod, Repository } from "../ingest/repository.js";
import { normalizeGtin } from "./gtin.js";
import { extractSize, normalizeHebrew, sizeKeyString, sizesCompatible } from "./hebrew.js";

export interface MatchThresholds {
  auto: number;
  review: number;
}

export interface MatchResult {
  productId: number;
  method: MatchMethod;
  score: number | null;
  needsReview: boolean;
}

/**
 * Order of attempts:
 *  1. chain item already mapped (same chain + item code) -> reuse, cheap and stable
 *  2. valid GTIN -> exact product by barcode (the reliable cross-chain key)
 *  3. no usable barcode (internal code, produce, bakery) -> trigram name match with a size guard
 *     - similarity >= auto: link
 *     - review <= similarity < auto: new product, flagged for human review
 *     - else: new product
 */
export async function matchItem(
  repo: Repository,
  chainId: string,
  item: PriceItem,
  th: MatchThresholds,
): Promise<MatchResult> {
  const existing = await repo.getChainItem(chainId, item.itemCode);
  const gtin = normalizeGtin({ itemCode: item.itemCode, itemType: item.itemType });
  const nameNorm = normalizeHebrew(item.name);
  const sizeKey = sizeKeyString(extractSize(nameNorm));

  if (existing && (existing.matchMethod === "gtin" || !gtin)) {
    return { productId: existing.productId, method: existing.matchMethod === "gtin" ? "gtin" : "chain-code", score: existing.matchScore, needsReview: existing.needsReview };
  }

  if (gtin) {
    const found = await repo.findProductByGtin(gtin);
    if (found) return { productId: found.id, method: "gtin", score: 1, needsReview: false };
    const created = await repo.createProduct({ gtin, name: item.name, nameNorm, sizeKey });
    return { productId: created.id, method: "gtin", score: 1, needsReview: false };
  }

  const candidates = await repo.findSimilarProducts(nameNorm, th.review, 5);
  const best = candidates.find((c) => sizesCompatible(sizeKey, c.sizeKey));
  if (best && best.similarity >= th.auto) {
    return { productId: best.id, method: "fuzzy", score: best.similarity, needsReview: false };
  }
  const created = await repo.createProduct({ gtin: null, name: item.name, nameNorm, sizeKey });
  return { productId: created.id, method: "new", score: best?.similarity ?? null, needsReview: Boolean(best) };
}
