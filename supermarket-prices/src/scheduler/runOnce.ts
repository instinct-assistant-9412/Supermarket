import { loadConfig } from "../config.js";
import { createPool, migrate } from "../db/pool.js";
import { PgRepository } from "../db/pgRepository.js";
import { allSources } from "../downloader/registry.js";
import { runDailyIngest } from "./dailyIngest.js";
import { loadScheduleConfig } from "./schedule.js";

// Manual run of exactly what the scheduler runs every day: npm run ingest:all
const config = loadConfig();
const sched = loadScheduleConfig();
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool);
  const report = await runDailyIngest({
    repo: new PgRepository(pool),
    config,
    sources: allSources({ userAgent: config.userAgent }),
    retry: { attempts: sched.attempts, baseDelayMs: sched.baseDelayMs, factor: 4 },
    log: (l) => console.log(l),
  });
  process.exitCode = report.chains.every((c) => c.status === "failed") ? 1 : 0;
} finally {
  await pool.end();
}
