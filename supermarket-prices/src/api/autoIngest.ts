import type { DailyIngestReport } from "../scheduler/dailyIngest.js";

export function loadApiIngestConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    onStart: env.API_INGEST_ON_START !== "false",
    scheduled: env.API_INGEST_SCHEDULED !== "false",
  };
}

export interface IngestStatus {
  phase: "idle" | "running" | "ok" | "partial" | "failed" | "disabled";
  reason?: string;
  startedAt?: string;
  finishedAt?: string;
  report?: DailyIngestReport;
  error?: string;
}

/** One writer per API process. Use the SAME repository as the API so SQLite's fuzzy index stays current. */
export function createAutoIngest(run: () => Promise<DailyIngestReport>, log: (line: string) => void, enabled = true) {
  let status: IngestStatus = { phase: enabled ? "idle" : "disabled" };
  let active: Promise<void> | undefined;
  let stopped = false;
  return {
    status: (): IngestStatus => structuredClone(status),
    run(reason: string): Promise<void> {
      if (stopped || !enabled) return Promise.resolve();
      if (active) {
        log(`[api-ingest] previous run still going, skipping (${reason})`);
        return active;
      }
      status = { phase: "running", reason, startedAt: new Date().toISOString() };
      log(`[api-ingest] starting (${reason})`);
      active = Promise.resolve().then(run).then((report) => {
        const failed = report.chains.every((c) => c.status === "failed");
        const ok = report.chains.length > 0 && report.chains.every((c) => c.status === "ok") && !report.freshnessError;
        status = { ...status, phase: failed ? "failed" : ok ? "ok" : "partial", report, finishedAt: new Date().toISOString() };
      }).catch((e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        status = { ...status, phase: "failed", error, finishedAt: new Date().toISOString() };
        log(`[api-ingest] failed: ${error}`);
      }).finally(() => { active = undefined; });
      return active;
    },
    async stop() {
      stopped = true;
      await active;
    },
  };
}
