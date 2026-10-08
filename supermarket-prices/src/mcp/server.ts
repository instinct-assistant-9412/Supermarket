import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config.js";
import { openStorage } from "../db/storage.js";
import { PriceService } from "../service.js";
import { buildMcpServer } from "./tools.js";

const config = loadConfig();
const storage = await openStorage(config);
const server = buildMcpServer(new PriceService(storage.repo), config);
await server.connect(new StdioServerTransport());
