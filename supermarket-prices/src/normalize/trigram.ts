/**
 * Trigram similarity compatible in spirit with PostgreSQL pg_trgm:
 * every word is padded with two spaces in front and one behind; similarity = |A∩B| / |A∪B|.
 * Used by the in-memory repository (tests) and as a reference for the SQL thresholds.
 */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
