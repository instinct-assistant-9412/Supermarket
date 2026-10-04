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
    "Search the Israeli supermarket catalog by Hebrew product name (e.g. 'חלב תנובה 3%') or barcode text. Start here to find a product. Returns product_id, GTIN (barcode), name, current min/max price in NIS across chains and how many chains carry it. Use the returned gtin or product_id with price_history and cheapest_basket.",
    { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
    async ({ query, limit }) => text(await service.searchProducts(query, limit ?? 10)),
  );

  server.tool(
    "price_history",
    "Price history in NIS of one product over time. Identify the product by product_id or gtin (preferred, exact) or a Hebrew name (best match). Optionally narrow to one chain_id (from list_chains) or store_key (from list_stores) and to the last N days. Points are recorded only when a price changes.",
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
    "Find the cheapest stores for a shopping basket. Each item is a gtin or a Hebrew name plus qty (default 1). area is free text matched against store city/address/name (e.g. 'ראש העין'); chain_ids restricts to chains from list_chains. Stores that carry every item come first, cheapest first; with require_all=false partial stores follow and missing_product_ids lists what they lack. Totals are in NIS. Physical branches and online stores are never mixed: online=true compares only online stores (default: only physical branches).",
    {
      items: z.array(z.object({ gtin: z.string().optional(), query: z.string().optional(), qty: z.number().positive().optional() })).min(1).max(100),
      area: z.string().optional(),
      chain_ids: z.array(z.string()).optional(),
      online: z.boolean().optional(),
      limit: z.number().int().min(1).max(20).optional(),
      require_all: z.boolean().optional(),
    },
    async (a) => text(await service.cheapestBasket(a.items, { text: a.area, chainIds: a.chain_ids, online: a.online }, { limit: a.limit, requireAll: a.require_all })),
  );

  server.tool(
    "data_freshness",
    "How up to date the stored prices are, per chain: status fresh / stale / never, age in hours, store count and number of current prices. Check this before trusting prices as 'today's' prices.",
    {},
    async () => text(evaluateFreshness(await service.freshness(), config)),
  );

  server.tool(
    "list_chains",
    "List the supermarket chains in the database (chain_id, name, number of stores with prices, number of current prices, freshness status). Use chain_id values as filters in cheapest_basket, price_history and list_stores.",
    {},
    async () => text(evaluateFreshness(await service.freshness(), config)),
  );

  server.tool(
    "list_stores",
    "List stores (branches and online stores) with store_key, chain, name, address, city and is_online. Filter by free-text area (city/address/name), chain_ids and online (true = online stores only, false = physical only, omitted = both). Use it to check which branches exist in an area.",
    {
      area: z.string().optional(),
      chain_ids: z.array(z.string()).optional(),
      online: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async (a) => text(await service.listStores({ text: a.area, chainIds: a.chain_ids, online: a.online, limit: a.limit })),
  );

  return server;
}
