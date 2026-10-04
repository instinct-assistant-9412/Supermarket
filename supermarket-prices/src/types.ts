export interface PriceItem {
  itemCode: string;
  /** 1 = barcode (GTIN) according to the price-transparency spec, 0 = chain internal code */
  itemType: number | null;
  name: string;
  manufacturer: string | null;
  manufacturerDescription: string | null;
  unitQty: string | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  isWeighted: boolean;
  qtyInPackage: string | null;
  price: number;
  unitPrice: number | null;
  priceUpdatedAt: Date | null;
  status: string | null;
}

export interface PriceFile {
  chainId: string;
  subChainId: string;
  storeId: string;
  items: PriceItem[];
  /** items that could not be read (missing code or price) */
  skipped: number;
}

export interface StoreRecord {
  chainId: string;
  subChainId: string;
  storeId: string;
  name: string | null;
  address: string | null;
  /** Some chains publish a CBS city code here (e.g. "3000"), others a name. Kept raw. */
  city: string | null;
  zip: string | null;
}

export type FileKind = "price" | "pricefull" | "promo" | "promofull" | "stores" | "unknown";

export interface RemoteFile {
  chainKey: string;
  name: string;
  kind: FileKind;
  chainId: string | null;
  subChainId: string | null;
  storeId: string | null;
  publishedAt: Date | null;
  /** opaque handle the source understands (URL, file name...) */
  ref: string;
}

export interface ChainSource {
  key: string;
  name: string;
  listFiles(kinds: FileKind[]): Promise<RemoteFile[]>;
  download(file: RemoteFile): Promise<Buffer>;
}
