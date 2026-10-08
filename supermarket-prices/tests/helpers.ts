import { gzipSync } from "node:zlib";
import type { ChainSource, FileKind, RemoteFile } from "../src/types.js";

/** Appends a valid GS1 check digit to a 12 digit body. */
export function gtin13(body12: string): string {
  const d = body12.split("").map(Number);
  let sum = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i]! * w;
  return body12 + String((10 - (sum % 10)) % 10);
}

export interface TItem {
  code: string;
  name: string;
  price: number;
  type?: number;
  weighted?: boolean;
}

export function priceXml(chainId: string, sub: string, store: string, items: TItem[], tag = "Manufacture"): string {
  const rows = items
    .map(
      (i) => `<Item><PriceUpdateTime>2026-10-04T08:00:00</PriceUpdateTime><ItemCode>${i.code}</ItemCode><ItemType>${i.type ?? 1}</ItemType>` +
        `<ItemName>${i.name}</ItemName><${tag}Name>יצרן</${tag}Name><UnitQty>גרם</UnitQty><Quantity>1.00</Quantity>` +
        `<bIsWeighted>${i.weighted ? 1 : 0}</bIsWeighted><ItemPrice>${i.price.toFixed(2)}</ItemPrice><UnitOfMeasurePrice>1.00</UnitOfMeasurePrice><ItemStatus>1</ItemStatus></Item>`,
    )
    .join("");
  return `<Root><ChainID>${chainId}</ChainID><SubChainID>${sub}</SubChainID><StoreID>${store}</StoreID><Items>${rows}</Items></Root>`;
}

export function storesXml(chainId: string, stores: Array<{ sub: string; id: string; name: string; city: string; address: string; type?: number }>): string {
  const body = stores
    .map((s) => `<SubChain><SubChainID>${s.sub}</SubChainID><Stores><Store><StoreID>${s.id}</StoreID>${s.type ? `<StoreType>${s.type}</StoreType>` : ""}<StoreName>${s.name}</StoreName><Address>${s.address}</Address><City>${s.city}</City></Store></Stores></SubChain>`)
    .join("");
  return `<Root><ChainID>${chainId}</ChainID><SubChains>${body}</SubChains></Root>`;
}

export class MockSource implements ChainSource {
  files = new Map<string, Buffer>();
  meta: RemoteFile[] = [];
  constructor(public key: string, public name: string) {}
  add(name: string, kind: FileKind, chainId: string, sub: string | null, store: string | null, at: Date, xml: string) {
    this.files.set(name, gzipSync(Buffer.from("\ufeff" + xml, "utf8")));
    this.meta.push({ chainKey: this.key, name, kind, chainId, subChainId: sub, storeId: store, publishedAt: at, ref: name });
  }
  async listFiles(kinds: FileKind[]) {
    return this.meta.filter((f) => kinds.includes(f.kind));
  }
  async download(f: RemoteFile) {
    const b = this.files.get(f.ref);
    if (!b) throw new Error("404 " + f.ref);
    return b;
  }
}
