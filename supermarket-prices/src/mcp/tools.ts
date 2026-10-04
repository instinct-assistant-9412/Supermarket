import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { evaluateFreshness } from "../quality/checks.js";
import type { PriceService } from "../service.js";

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export function buildMcpServer(service: PriceService, config: Pick<Config, "maxFileAgeHours">): McpServer {
  const server = new McpServer({ name: "supermarket-prices", version: "0.1.0" });

  server.tool(
    "search_products",
    "Search Israeli supermarket products by Hebrew name or barcode text. Returns product ids, GTIN and current min/max price across chains.",
    { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
    async ({ query, limit }) => text(await service.searchProducts(query, limit ?? 10)),
  );

  server.tool(
    "price_history",
    "Price history of one product (by product id, GTIN or Hebrew name), optionally for one chain or store.",
    {
      product_id: z.number().int().optional(),
      gtin: z.string().optional(),
      query: z.string().optional(),
      chain_id: z.string().optional(),
      store_key: z.string().optional(),
      days: z.number().int().min(1).max(3650).optional(),
    },
    async (a) => {
      const out = await service.priceHistory({ id: a.product_id, gtin: a.gtin, query: a.query }, { chainId: a.chain_id, storeKey: a.store_key, days: a.days });
      return text(out ?? { error: "product not found" });
    },
  );

  server.tool(
    "cheapest_basket",
    "Find the cheapest stores for a shopping basket in an area. Items are barcodes or Hebrew names with quantities; area is free text matched against store city/address/name.",
    {
      items: z.array(z.object({ gtin: z.string().optional(), query: z.string().optional(), qty: z.number().positive().optional() })).min(1).max(100),
      area: z.string().optional(),
      chain_ids: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(20).optional(),
      require_all: z.boolean().optional(),
    },
    async (a) => text(await service.cheapestBasket(a.items, { text: a.area, chainIds: a.chain_ids }, { limit: a.limit, requireAll: a.require_all })),
  );

  server.tool("data_freshness", "Per-chain freshness of the stored price data (fresh / stale / never).", {}, async () =>
    text(evaluateFreshness(await service.freshness(), config)),
  );

  return server;
}
