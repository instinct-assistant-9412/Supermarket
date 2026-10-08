import type { FileKind } from "../types.js";

export interface ParsedFileName {
  kind: FileKind;
  chainId: string | null;
  subChainId: string | null;
  storeId: string | null;
  publishedAt: Date | null;
}

/**
 * File names follow the price-transparency convention, e.g.
 *   PriceFull7290027600007-001-001-20261004-170000.gz   (kind, chain, [sub-chain], store, yyyymmdd-hhmmss)
 *   Stores7290058140886-000-20261004-050500.xml         (no store id)
 * Real files vary (separators, missing seconds, store without sub-chain); anything unknown yields nulls.
 */
export function parseFileName(name: string): ParsedFileName {
  // Laib Stores uses YYYYMMDDHHMMSS-HHMMSS; normalize to the common date/time form.
  const base = name.replace(/\.(gz|xml|zip)$/i, "").replace(/^(Stores.*-)(\d{8})(\d{6})-\d{6}$/i, "$1$2-$3");
  const m = base.match(/^(PriceFull|Price|PromoFull|Promo|Stores)[_-]?(\d{6,13})(?:-(\d{1,4}))?(?:-(\d{1,4}))?-(\d{8})-?(\d{3,6})?$/i);
  if (!m) return { kind: "unknown", chainId: null, subChainId: null, storeId: null, publishedAt: null };
  const kind = m[1]!.toLowerCase() as FileKind;
  const chainId = m[2]!;
  let sub: string | null;
  let store: string | null;
  if (kind === "stores") {
    sub = m[3] ?? null;
    store = null;
  } else if (m[4] !== undefined) {
    sub = m[3] ?? null;
    store = m[4];
  } else {
    sub = null;
    store = m[3] ?? null;
  }
  const d = m[5]!;
  const t = (m[6] ?? "0000").padEnd(6, "0");
  const publishedAt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)));
  return { kind, chainId, subChainId: sub, storeId: store, publishedAt };
}
