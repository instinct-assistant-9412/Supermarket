/** צורת התשובות של ה-API (ראו src/api/app.ts בצד השרת). תאריכים מגיעים כמחרוזות ISO. */
export interface Product {
  id: number;
  gtin: string | null;
  name: string;
  nameNorm: string;
  sizeKey: string | null;
}

export interface SearchHit extends Product {
  minPrice: number | null;
  maxPrice: number | null;
  chains: number;
  score: number;
}

export interface HistoryPoint {
  chainId: string;
  storeKey: string;
  price: number;
  validFrom: string;
}

export interface HistoryResponse {
  product: Product;
  points: HistoryPoint[];
}

export interface StoreRow {
  chainId: string;
  chainName: string | null;
  storeKey: string;
  storeName: string | null;
  address: string | null;
  city: string | null;
  isOnline: boolean;
}

export interface BasketInput {
  gtin?: string;
  query?: string;
  qty?: number;
}

export interface BasketArea {
  text?: string;
  chainIds?: string[];
  storeKeys?: string[];
  online?: boolean;
}

export interface BasketStore {
  chainId: string;
  chainName: string | null;
  storeKey: string;
  storeName: string | null;
  address: string | null;
  city: string | null;
  isOnline: boolean;
  total: number;
  found: number;
  missingProductIds: number[];
}

export interface BasketResponse {
  resolved: Array<{ input: BasketInput; product: Product | null; note?: string }>;
  stores: BasketStore[];
  complete: boolean;
}

export interface ChainFreshness {
  chainId: string;
  chainName: string | null;
  status: "fresh" | "stale" | "never";
  ageHours: number | null;
  stores: number;
  currentPrices: number;
}

export interface ReviewItem {
  chainId: string;
  itemCode: string;
  productId: number;
  rawName: string;
  matchMethod: string;
  matchScore: number | null;
  needsReview: boolean;
  productName: string;
}
