export interface ScheduleConfig {
  /** cron expression (node-cron syntax) */
  cron: string;
  timezone: string;
  runOnStart: boolean;
  attempts: number;
  baseDelayMs: number;
}

function int(v: string | undefined, d: number, min: number, max: number): number {
  const n = v === undefined || v.trim() === "" ? NaN : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : d;
}

/**
 * INGEST_CRON (full expression) wins; otherwise INGEST_HOUR / INGEST_MINUTE (default 06:00).
 * Time zone defaults to Israel time.
 */
export function loadScheduleConfig(env: NodeJS.ProcessEnv = process.env): ScheduleConfig {
  const custom = env.INGEST_CRON?.trim();
  const hour = int(env.INGEST_HOUR, 6, 0, 23);
  const minute = int(env.INGEST_MINUTE, 0, 0, 59);
  return {
    cron: custom ? custom : `${minute} ${hour} * * *`,
    timezone: env.INGEST_TZ?.trim() || "Asia/Jerusalem",
    runOnStart: /^(1|true|yes)$/i.test(env.INGEST_RUN_ON_START ?? ""),
    attempts: int(env.INGEST_RETRY_ATTEMPTS, 3, 1, 10),
    baseDelayMs: int(env.INGEST_RETRY_BASE_SECONDS, 60, 0, 3600) * 1000,
  };
}
