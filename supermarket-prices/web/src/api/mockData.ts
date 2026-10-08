import type { HistoryPoint, Product, StoreRow } from "./types";

/** נתוני דמו דטרמיניסטיים (מלבד התאריכים שיחסיים להרגע). לא נתוני אמת. */
export const MOCK_CHAINS = [
  { chainId: "7290027600007", name: "שופרסל", factor: 1.04, ageHours: 9, stores: 3 },
  { chainId: "7290058140886", name: "רמי לוי", factor: 0.95, ageHours: 7, stores: 3 },
  { chainId: "7290055700007", name: "קרפור", factor: 1.0, ageHours: 30, stores: 3 },
  { chainId: "7290696200003", name: "ויקטורי", factor: 1.02, ageHours: 71, stores: 2 },
];

const BASE: Array<[string, number]> = [
  ["חלב תנובה 3% 1 ליטר", 6.9],
  ["חלב טרה 1% 1 ליטר", 6.6],
  ["קוטג' תנובה 5% 250 גרם", 6.2],
  ["גבינה לבנה 5% 250 גרם", 5.9],
  ["יוגורט פרו וניל 200 גרם", 4.7],
  ["ביצים L תריסר", 14.5],
  ["לחם אחיד פרוס 750 גרם", 8.5],
  ["פיתות 10 יחידות", 9.9],
  ["אורז בסמטי סוגת 1 ק\"ג", 12.9],
  ["אורז פרסי סוגת 1 ק\"ג", 11.5],
  ["פסטה ספגטי אסם 500 גרם", 5.5],
  ["קמח לבן אדום 1 ק\"ג", 4.9],
  ["סוכר לבן 1 ק\"ג", 5.2],
  ["שמן זית כתית מעולה 750 מ\"ל", 34.9],
  ["שמן קנולה 1 ליטר", 11.9],
  ["טחינה גולמית אל ארז 500 גרם", 16.9],
  ["חומוס אחלה 400 גרם", 8.9],
  ["טונה בשמן צמחי 4 יחידות", 21.9],
  ["עגבניות שרי 500 גרם", 12.9],
  ["מלפפונים 1 ק\"ג", 7.9],
  ["בננות 1 ק\"ג", 8.9],
  ["קפה נמס עלית 200 גרם", 26.9],
  ["תה ויסוצקי 25 שקיקים", 9.9],
  ["קורנפלקס תלמה 750 גרם", 19.9],
  ["שוקולד פרה חלב 100 גרם", 6.9],
  ["מים מינרלים נביעות 6x1.5 ליטר", 15.9],
  ["קולה זירו 1.5 ליטר", 7.9],
  ["נייר טואלט 32 גלילים", 39.9],
  ["אבקת כביסה אריאל 3 ק\"ג", 54.9],
  ["סבון כלים פיירי 750 מ\"ל", 12.9],
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gtinFor(id: number): string {
  const body = `72900100${String(id).padStart(4, "0")}`;
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return body + String((10 - (sum % 10)) % 10);
}

export const MOCK_PRODUCTS: Product[] = BASE.map(([name, _], i) => ({
  id: i + 1,
  gtin: gtinFor(i + 1),
  name,
  nameNorm: name.replace(/[%"']/g, "").toLowerCase(),
  sizeKey: null,
}));

const STORE_DEFS: Array<{ chain: number; name: string; city: string; address: string; online?: boolean }> = [
  { chain: 0, name: "שופרסל דיל ראש העין", city: "ראש העין", address: "הרצל 12" },
  { chain: 0, name: "שופרסל שלי תל אביב", city: "תל אביב", address: "דיזנגוף 80" },
  { chain: 0, name: "שופרסל אונליין", city: "אונליין", address: "משלוחים", online: true },
  { chain: 1, name: "רמי לוי ראש העין", city: "ראש העין", address: "סירקין 3" },
  { chain: 1, name: "רמי לוי פתח תקווה", city: "פתח תקווה", address: "ז'בוטינסקי 40" },
  { chain: 1, name: "רמי לוי אונליין", city: "אונליין", address: "משלוחים", online: true },
  { chain: 2, name: "קרפור סיטי ראש העין", city: "ראש העין", address: "מגדלי הים 5" },
  { chain: 2, name: "קרפור היפר פתח תקווה", city: "פתח תקווה", address: "הברזל 7" },
  { chain: 2, name: "קרפור אונליין", city: "אונליין", address: "משלוחים", online: true },
  { chain: 3, name: "ויקטורי ראש העין", city: "ראש העין", address: "העצמאות 22" },
  { chain: 3, name: "ויקטורי תל אביב", city: "תל אביב", address: "אבן גבירול 100" },
];

export const MOCK_STORES: StoreRow[] = STORE_DEFS.map((s, i) => ({
  chainId: MOCK_CHAINS[s.chain]!.chainId,
  chainName: MOCK_CHAINS[s.chain]!.name,
  storeKey: String(i + 1),
  storeName: s.name,
  address: s.address,
  city: s.city,
  isOnline: s.online === true,
}));

const DAY = 86400_000;

/** היסטוריית מחירים: נקודה רק כשהמחיר משתנה (כמו ב-API האמיתי). */
export function mockHistory(productId: number, now = Date.now()): HistoryPoint[] {
  const base = BASE[productId - 1]?.[1];
  if (base === undefined) return [];
  const r = rng(productId * 7919);
  const points: HistoryPoint[] = [];
  for (const store of MOCK_STORES) {
    const chain = MOCK_CHAINS.find((c) => c.chainId === store.chainId)!;
    // לא כל מוצר בכל רשת
    if (r() < 0.08) continue;
    let price = base * chain.factor * (store.isOnline ? 1.06 : 1) * (0.97 + r() * 0.06);
    let t = now - (110 + r() * 10) * DAY;
    points.push({ chainId: store.chainId, storeKey: store.storeKey, price: round(price), validFrom: new Date(t).toISOString() });
    while (true) {
      t += (6 + r() * 22) * DAY;
      if (t > now - 0.5 * DAY) break;
      const sale = r() < 0.25;
      price = Math.max(1.5, price * (sale ? 0.86 + r() * 0.06 : 0.96 + r() * 0.1));
      points.push({ chainId: store.chainId, storeKey: store.storeKey, price: round(price), validFrom: new Date(t).toISOString() });
    }
  }
  return points.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}
