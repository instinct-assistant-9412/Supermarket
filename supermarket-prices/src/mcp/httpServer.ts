import { serve } from "@hono/node-server";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { PgRepository } from "../db/pgRepository.js";
import { PriceService } from "../service.js";
import { buildMcpServer } from "./tools.js";
import { createMcpHttpApp } from "./http.js";

const config = loadConfig();
const service = new PriceService(new PgRepository(createPool(config.databaseUrl)));
const token = process.env.MCP_AUTH_TOKEN?.trim() || undefined;
const port = Number(process.env.MCP_PORT ?? 3001);
const host = process.env.MCP_HOST ?? "127.0.0.1";
const app = createMcpHttpApp(() => buildMcpServer(service, config), { authToken: token });
serve({ fetch: app.fetch, port, hostname: host }, (i) => {
  console.log(`MCP (streamable HTTP) on http://${host}:${i.port}/mcp  auth=${token ? "bearer token" : "NONE (local use only)"}`);
});
