import { serve } from "@hono/node-server";
import { loadConfig } from "../config.js";
import { openStorage } from "../db/storage.js";
import { PriceService } from "../service.js";
import { createApp } from "./app.js";

const config = loadConfig();
const storage = await openStorage(config);
if (storage.driver === "sqlite") await storage.migrate();
const app = createApp(new PriceService(storage.repo), config, { corsOrigin: process.env.CORS_ORIGIN });
serve({ fetch: app.fetch, port: config.apiPort }, (i) => console.log(`API listening on :${i.port} (db: ${storage.driver}${storage.driver === "sqlite" ? " " + config.sqlitePath : ""})`));
