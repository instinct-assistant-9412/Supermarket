import type { HistoryPoint } from "./api/types";

const nf = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2 });
export const formatPrice = (n: number | null | undefined) => (n === null || n === undefined ? "-" : nf.format(n));

export function formatAge(hours: number | null): string {
  if (hours === null) return "אין נתונים";
  if (hours < 1) return "לפני פחות משעה";
  if (hours < 48) return `לפני ${Math.round(hours)} שעות`;
  return `לפני ${Math.round(hours / 24)} ימים`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

const PALETTE = ["#0b7a5b", "#e8590c", "#1c7ed6", "#9c36b5", "#c92a2a", "#0c8599", "#e67700", "#5c7cfa"];
const KNOWN: Record<string, string> = {
  "7290027600007": "#1c7ed6", // שופרסל
  "7290058140886": "#e8590c", // רמי לוי
  "7290055700007": "#0b7a5b", // קרפור
  "7290696200003": "#9c36b5", // ויקטורי
};
export function chainColor(chainId: string): string {
  const known = KNOWN[chainId];
  if (known) return known;
  let h = 0;
  for (const ch of chainId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export interface Series {
  chainId: string;
  points: Array<{ t: number; price: number }>;
}

/**
 * לכל רשת: המחיר הזול ביותר בין הסניפים שלה לאורך זמן (קו מדרגות).
 * ההיסטוריה ב-API נשמרת רק בשינוי מחיר, לכן "המחיר ברגע t" הוא הנקודה האחרונה של כל סניף עד t.
 */
export function buildChainSeries(points: HistoryPoint[], keep: (p: HistoryPoint) => boolean = () => true): Series[] {
  const byChain = new Map<string, HistoryPoint[]>();
  for (const p of points) {
    if (!keep(p)) continue;
    const list = byChain.get(p.chainId) ?? [];
    list.push(p);
    byChain.set(p.chainId, list);
  }
  const out: Series[] = [];
  for (const [chainId, list] of byChain) {
    const sorted = [...list].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const latest = new Map<string, number>();
    const pts: Series["points"] = [];
    for (const p of sorted) {
      latest.set(p.storeKey, p.price);
      const min = Math.min(...latest.values());
      const t = new Date(p.validFrom).getTime();
      const last = pts[pts.length - 1];
      if (last && last.price === min) continue;
      if (last && last.t === t) last.price = min;
      else pts.push({ t, price: min });
    }
    out.push({ chainId, points: pts });
  }
  return out.sort((a, b) => a.chainId.localeCompare(b.chainId));
}

export interface CurrentPrice {
  chainId: string;
  storeKey: string;
  price: number;
  since: string;
}

/** המחיר הנוכחי לכל סניף = הנקודה האחרונה בהיסטוריה שלו. */
export function currentPrices(points: HistoryPoint[]): CurrentPrice[] {
  const latest = new Map<string, HistoryPoint>();
  for (const p of points) {
    const k = `${p.chainId}|${p.storeKey}`;
    const prev = latest.get(k);
    if (!prev || prev.validFrom <= p.validFrom) latest.set(k, p);
  }
  return [...latest.values()].map((p) => ({ chainId: p.chainId, storeKey: p.storeKey, price: p.price, since: p.validFrom }));
}
