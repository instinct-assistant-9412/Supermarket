import { trigrams } from "./trigram.js";

/**
 * Inverted trigram index in process memory. It replaces the pg_trgm GIN index in local (SQLite) mode.
 * Same similarity definition as pg_trgm (see trigram.ts), so thresholds mean the same thing,
 * but it is exact only for what is loaded here: it is rebuilt from the products table on start.
 */
export class TrigramIndex {
  private byTrigram = new Map<string, number[]>();
  private sizes = new Map<number, number>();

  add(id: number, text: string): void {
    const t = trigrams(text);
    this.sizes.set(id, t.size);
    for (const g of t) {
      const list = this.byTrigram.get(g);
      if (list) list.push(id);
      else this.byTrigram.set(g, [id]);
    }
  }

  /** ids with similarity >= min, best first */
  query(text: string, min: number, limit: number): Array<{ id: number; similarity: number }> {
    const q = trigrams(text);
    if (q.size === 0) return [];
    const inter = new Map<number, number>();
    for (const g of q) for (const id of this.byTrigram.get(g) ?? []) inter.set(id, (inter.get(id) ?? 0) + 1);
    const out: Array<{ id: number; similarity: number }> = [];
    for (const [id, n] of inter) {
      const sim = n / (q.size + (this.sizes.get(id) ?? 0) - n);
      if (sim >= min) out.push({ id, similarity: sim });
    }
    return out.sort((a, b) => b.similarity - a.similarity || a.id - b.id).slice(0, limit);
  }

  get size(): number {
    return this.sizes.size;
  }
}
