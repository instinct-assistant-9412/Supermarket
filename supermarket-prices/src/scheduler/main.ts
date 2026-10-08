import cron from "node-cron";
import { loadConfig } from "../config.js";
import { openStorage } from "../db/storage.js";
import { configuredSources } from "../downloader/registry.js";
import { runDailyIngest } from "./dailyIngest.js";
import { loadScheduleConfig } from "./schedule.js";

const config = loadConfig();
const sched = loadScheduleConfig();
const storage = await openStorage(config);
const repo = storage.repo;
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

if (!cron.validate(sched.cron)) {
  console.error(`invalid INGEST_CRON / INGEST_HOUR: "${sched.cron}"`);
  process.exit(1);
}

let running = false;
async function run(reason: string) {
  if (running) {
    log(`[scheduler] previous run still going, skipping (${reason})`);
    return;
  }
  running = true;
  log(`[scheduler] starting daily ingest (${reason})`);
  try {
    await runDailyIngest({
      repo,
      config,
      sources: configuredSources({ userAgent: config.userAgent }, config.onlineOnly),
      retry: { attempts: sched.attempts, baseDelayMs: sched.baseDelayMs, factor: 4 },
      log,
    });
  } catch (e) {
    log(`[scheduler] run crashed: ${(e as Error).stack ?? e}`);
  } finally {
    running = false;
  }
}

// the schema must exist before the first run (idempotent)
await storage.migrate();
cron.schedule(sched.cron, () => void run("schedule"), { timezone: sched.timezone });
log(`[scheduler] up. cron="${sched.cron}" tz=${sched.timezone} attempts=${sched.attempts}`);
if (sched.runOnStart) void run("run on start");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`[scheduler] ${sig}, shutting down`);
    void storage.close().finally(() => process.exit(0));
  });
}
