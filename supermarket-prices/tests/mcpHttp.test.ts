import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpHttpApp } from "../src/mcp/http.js";
import { buildMcpServer } from "../src/mcp/tools.js";
import { MemoryRepository } from "../src/ingest/memoryRepository.js";
import { PriceService } from "../src/service.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig({});

async function seeded() {
  const repo = new MemoryRepository();
  await repo.upsertChain("111", "רשת א");
  await repo.upsertStores([
    { chainId: "111", subChainId: "1", storeId: "5", name: "סניף ראש העין", address: "הרצל 1", city: "ראש העין", zip: null, isOnline: false },
    { chainId: "111", subChainId: "1", storeId: "9", name: "אונליין", address: null, city: null, zip: null, isOnline: true },
  ]);
  return new PriceService(repo);
}

const rpc = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify(body),
});
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } };

describe("MCP over streamable HTTP", () => {
  it("initialize + tools/list over plain HTTP POST", async () => {
    const svc = await seeded();
    const app = createMcpHttpApp(() => buildMcpServer(svc, config));
    const r1 = await app.request("/mcp", rpc(init));
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as any).result.serverInfo.name).toBe("supermarket-prices");
    const r2 = await app.request("/mcp", rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    const names = ((await r2.json()) as any).result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["cheapest_basket", "data_freshness", "list_chains", "list_stores", "price_history", "search_products"]);
  });

  it("works with the official HTTP client transport and calls a tool", async () => {
    const svc = await seeded();
    const app = createMcpHttpApp(() => buildMcpServer(svc, config));
    const fetchImpl = ((url: any, init?: any) => app.fetch(new Request(url, init))) as typeof fetch;
    const client = new Client({ name: "t", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("http://local/mcp"), { fetch: fetchImpl }));
    const res = (await client.callTool({ name: "list_stores", arguments: { area: "ראש העין" } })) as { content: Array<{ text: string }> };
    const stores = JSON.parse(res.content[0]!.text);
    expect(stores).toHaveLength(1);
    expect(stores[0].city).toBe("ראש העין");
    const online = JSON.parse(((await client.callTool({ name: "list_stores", arguments: { online: true } })) as any).content[0].text);
    expect(online.map((s: any) => s.isOnline)).toEqual([true]);
    await client.close();
  });

  it("bearer token is enforced when configured", async () => {
    const svc = await seeded();
    const app = createMcpHttpApp(() => buildMcpServer(svc, config), { authToken: "s3cret" });
    expect((await app.request("/mcp", rpc(init))).status).toBe(401);
    expect((await app.request("/mcp", rpc(init, { authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await app.request("/mcp", rpc(init, { authorization: "Bearer s3cret" }))).status).toBe(200);
    expect((await app.request("/health")).status).toBe(200);
  });

  it("GET (no session stream) is rejected in stateless mode", async () => {
    const app = createMcpHttpApp(() => buildMcpServer(new PriceService(new MemoryRepository()), config));
    expect((await app.request("/mcp", { method: "GET" })).status).toBe(405);
  });
});
