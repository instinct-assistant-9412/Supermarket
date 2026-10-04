import { serve } from "@hono/node-server";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { PgRepository } from "../db/pgRepository.js";
import { PriceService } from "../service.js";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = createApp(new PriceService(new PgRepository(pool)), config);
serve({ fetch: app.fetch, port: config.apiPort }, (i) => console.log(`API listening on :${i.port}`));
