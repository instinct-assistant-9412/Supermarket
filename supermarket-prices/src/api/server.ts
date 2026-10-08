import { serve } from "@hono/node-server";
import cron from "node-cron";
import { loadConfig } from "../config.js";
import { openStorage } from "../db/storage.js";
import { PriceService } from "../service.js";
import { configuredSources } from "../downloader/registry.js";
import { runDailyIngest } from "../scheduler/dailyIngest.js";
import { loadScheduleConfig } from "../scheduler/schedule.js";
import { createAutoIngest, loadApiIngestConfig } from "./autoIngest.js";
import { createApp } from "./app.js";

const config = loadConfig();
const apiIngest = loadApiIngestConfig();
const sched = loadScheduleConfig();
if (apiIngest.scheduled) {
  if (!cron.validate(sched.cron)) throw new Error(`invalid INGEST_CRON: ${sched.cron}`);
  new Intl.DateTimeFormat("en", { timeZone: sched.timezone }); // reject invalid zones before listening
}
const storage = await openStorage(config);
await storage.migrate();
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const ingest = createAutoIngest(() => runDailyIngest({
  repo: storage.repo,
  config,
  sources: configuredSources({ userAgent: config.userAgent }, config.onlineOnly),
  retry: { attempts: sched.attempts, baseDelayMs: sched.baseDelayMs, factor: 4 },
  log,
}), log, apiIngest.onStart || apiIngest.scheduled);
const app = createApp(new PriceService(storage.repo), config, {
  corsOrigin: process.env.CORS_ORIGIN,
  ingestStatus: ingest.status,
});
let task: ReturnType<typeof cron.schedule> | undefined;
let closing = false;
const server = serve({ fetch: app.fetch, port: config.apiPort }, (i) => {
  log(`API listening on :${i.port} (db: ${storage.driver}${storage.driver === "sqlite" ? " " + config.sqlitePath : ""})`);
  if (apiIngest.scheduled) {
    task = cron.schedule(sched.cron, () => void ingest.run("schedule"), { timezone: sched.timezone });
    log(`[api-ingest] cron="${sched.cron}" tz=${sched.timezone}`);
  }
  if (apiIngest.onStart) void ingest.run("startup");
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    task?.stop();
    log(`[api-ingest] ${sig}, waiting for active ingestion before closing storage`);
    server.close(() => {
      void ingest.stop().then(() => storage.close()).then(() => process.exit(0));
    });
  });
}
