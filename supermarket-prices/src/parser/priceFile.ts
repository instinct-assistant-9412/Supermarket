import { XMLParser } from "fast-xml-parser";
import type { PriceFile, PriceItem, StoreRecord } from "../types.js";
import { decodeXmlBuffer } from "./decode.js";

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // keep "007" and long barcodes as strings
  trimValues: true,
  isArray: (name) => ["item", "product", "store", "branch", "subchain"].includes(name.toLowerCase()),
});

type Node = Record<string, unknown>;

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Case-insensitive field lookup over several candidate tag names (chains differ). */
export function pick(node: Node, ...names: string[]): string | null {
  const wanted = names.map((n) => n.toLowerCase());
  for (const key of Object.keys(node)) {
    if (wanted.includes(key.toLowerCase())) {
      const v = node[key];
      if (v === undefined || v === null) return null;
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v).trim();
        return s === "" ? null : s;
      }
    }
  }
  return null;
}

/** Walks the tree and returns every object found under a key named like one of `names`. */
function collect(node: unknown, names: string[], out: Node[] = []): Node[] {
  const wanted = names.map((n) => n.toLowerCase());
  if (Array.isArray(node)) {
    for (const n of node) collect(n, names, out);
  } else if (isNode(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (wanted.includes(k.toLowerCase())) {
        for (const x of Array.isArray(v) ? v : [v]) if (isNode(x)) out.push(x);
      } else {
        collect(v, names, out);
      }
    }
  }
  return out;
}

const UNKNOWN = /^(לא ?ידוע|unknown|null|0)$/i;

export function toNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function cleanText(v: string | null): string | null {
  if (v === null) return null;
  return UNKNOWN.test(v) ? null : v;
}

export function parseDate(v: string | null): Date | null {
  if (!v) return null;
  // formats seen: 2026-10-04T13:51:00, 2026-10-04 13:51, 04/10/2026 13:51
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) return new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!, +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0)));
  const il = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (il) return new Date(Date.UTC(+il[3]!, +il[2]! - 1, +il[1]!, +(il[4] ?? 0), +(il[5] ?? 0)));
  return null;
}

export function parsePriceFile(buf: Buffer | string): PriceFile {
  const xml = typeof buf === "string" ? buf : decodeXmlBuffer(buf);
  const doc = parser.parse(xml) as Node;
  const root = (Object.values(doc).find(isNode) ?? {}) as Node;
  const chainId = pick(root, "ChainId") ?? "";
  const subChainId = pick(root, "SubChainId") ?? "0";
  const storeId = pick(root, "StoreId") ?? "";
  const itemNodes = collect(root, ["Item", "Product"]);
  const items: PriceItem[] = [];
  let skipped = 0;
  for (const n of itemNodes) {
    const code = pick(n, "ItemCode");
    const price = toNumber(pick(n, "ItemPrice", "Price"));
    const name = pick(n, "ItemName", "ItemNm", "ManufacturerItemDescription", "ManufactureItemDescription");
    if (!code || price === null || !name) {
      skipped++;
      continue;
    }
    items.push({
      itemCode: code,
      itemType: toNumber(pick(n, "ItemType")),
      name,
      // the spec says "Manufacturer*", real files use "Manufacture*" (verified on live files)
      manufacturer: cleanText(pick(n, "ManufacturerName", "ManufactureName")),
      manufacturerDescription: cleanText(pick(n, "ManufacturerItemDescription", "ManufactureItemDescription")),
      unitQty: cleanText(pick(n, "UnitQty")),
      quantity: toNumber(pick(n, "Quantity")),
      unitOfMeasure: cleanText(pick(n, "UnitOfMeasure")),
      isWeighted: pick(n, "bIsWeighted", "IsWeighted") === "1",
      qtyInPackage: cleanText(pick(n, "QtyInPackage")),
      price,
      unitPrice: toNumber(pick(n, "UnitOfMeasurePrice", "UnitPrice")),
      priceUpdatedAt: parseDate(pick(n, "PriceUpdateTime", "PriceUpdateDate")),
      status: pick(n, "ItemStatus"),
    });
  }
  return { chainId, subChainId, storeId, items, skipped };
}

export function parseStoresFile(buf: Buffer | string): StoreRecord[] {
  const xml = typeof buf === "string" ? buf : decodeXmlBuffer(buf);
  const doc = parser.parse(xml) as Node;
  const root = (Object.values(doc).find(isNode) ?? {}) as Node;
  const chainId = pick(root, "ChainId") ?? "";
  const out: StoreRecord[] = [];
  const subChains = collect(root, ["SubChain"]);
  const scopes = subChains.length ? subChains : [root];
  for (const sc of scopes) {
    const subChainId = pick(sc, "SubChainId") ?? "0";
    for (const s of collect(sc, ["Store", "Branch"])) {
      const storeId = pick(s, "StoreId");
      if (!storeId) continue;
      out.push({
        chainId,
        subChainId,
        storeId,
        name: pick(s, "StoreName"),
        address: pick(s, "Address"),
        city: pick(s, "City"),
        zip: pick(s, "ZipCode"),
        isOnline: pick(s, "StoreType")?.trim() === "2",
      });
    }
  }
  return out;
}
