import { loadConfig } from "../config.js";
import { openStorage } from "../db/storage.js";
import { allSources } from "../downloader/registry.js";
import { runDailyIngest } from "./dailyIngest.js";
import { loadScheduleConfig } from "./schedule.js";

// Manual run of exactly what the scheduler runs every day: npm run ingest:all
const config = loadConfig();
const sched = loadScheduleConfig();
const storage = await openStorage(config);
try {
  await storage.migrate();
  const report = await runDailyIngest({
    repo: storage.repo,
    config,
    sources: allSources({ userAgent: config.userAgent }),
    retry: { attempts: sched.attempts, baseDelayMs: sched.baseDelayMs, factor: 4 },
    log: (l) => console.log(l),
  });
  process.exitCode = report.chains.every((c) => c.status === "failed") ? 1 : 0;
} finally {
  await storage.close();
}
