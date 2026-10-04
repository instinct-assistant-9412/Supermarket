import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { PgRepository } from "../db/pgRepository.js";
import { PriceService } from "../service.js";
import { buildMcpServer } from "./tools.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const server = buildMcpServer(new PriceService(new PgRepository(pool)), config);
await server.connect(new StdioServerTransport());
