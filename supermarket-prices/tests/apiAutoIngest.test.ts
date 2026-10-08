import { describe, expect, it, vi } from "vitest";
import { createAutoIngest, loadApiIngestConfig } from "../src/api/autoIngest.js";
import { createApp } from "../src/api/app.js";
import { PriceService } from "../src/service.js";
import { openStorage } from "../src/db/storage.js";
import { runDailyIngest } from "../src/scheduler/dailyIngest.js";
import { MockSource, gtin13, priceXml, storesXml } from "./helpers.js";
import { MemoryRepository } from "../src/ingest/memoryRepository.js";
import { loadConfig } from "../src/config.js";
import type { DailyIngestReport } from "../src/scheduler/dailyIngest.js";

function report(statuses: ("ok" | "partial" | "failed")[] = ["ok"]): DailyIngestReport {
  return { startedAt: new Date(), finishedAt: new Date(), freshness: [], chains: statuses.map((status, i) => ({
    chain: String(i), status, attempts: 1, filesIngested: status === "failed" ? 0 : 1,
    filesSkipped: 0, fileFailures: status === "failed" ? 1 : 0, durationMs: 1,
  })) };
}

describe("API automatic ingest", () => {
  it("defaults to startup + daily, independently disabled without changing scheduler env semantics", () => {
    expect(loadApiIngestConfig({})).toEqual({ onStart: true, scheduled: true });
    expect(loadApiIngestConfig({ API_INGEST_ON_START: "false" })).toEqual({ onStart: false, scheduled: true });
    expect(loadApiIngestConfig({ API_INGEST_SCHEDULED: "false", INGEST_RUN_ON_START: "false" })).toEqual({ onStart: true, scheduled: false });
  });
  it("runs in background, reports status over HTTP, and suppresses overlapping runs", async () => {
    let resolve!: (r: DailyIngestReport) => void;
    const work = vi.fn(() => new Promise<DailyIngestReport>((r) => { resolve = r; }));
    const control = createAutoIngest(work, () => {});
    const pending = control.run("startup");
    expect(control.run("schedule")).toBe(pending);
    const app = createApp(new PriceService(new MemoryRepository()), loadConfig({}), { ingestStatus: control.status });
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
    expect(await (await app.request("/ingest/status")).json()).toMatchObject({ phase: "running", reason: "startup" });
    expect(work).toHaveBeenCalledTimes(1);
    resolve(report());
    await pending;
    expect(control.status().phase).toBe("ok");
  });
  it("distinguishes partial/all failed and retries on a later trigger", async () => {
    const work = vi.fn().mockResolvedValueOnce(report(["ok", "failed"])).mockResolvedValueOnce(report(["failed"])).mockResolvedValueOnce(report());
    const control = createAutoIngest(work, () => {});
    await control.run("startup"); expect(control.status().phase).toBe("partial");
    await control.run("schedule"); expect(control.status().phase).toBe("failed");
    await control.run("schedule"); expect(control.status().phase).toBe("ok");
  });
  it("contains unexpected failure instead of taking the API down", async () => {
    const control = createAutoIngest(async () => { throw new Error("offline"); }, () => {});
    await expect(control.run("startup")).resolves.toBeUndefined();
    expect(control.status()).toMatchObject({ phase: "failed", error: "offline" });
  });
  it("drains active work before closing and does not start after stop", async () => {
    let resolve!: (r: DailyIngestReport) => void;
    const work = vi.fn(() => new Promise<DailyIngestReport>((r) => { resolve = r; }));
    const control = createAutoIngest(work, () => {});
    const running = control.run("startup");
    await Promise.resolve();
    let drained = false;
    const stopping = control.stop().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    resolve(report()); await running; await stopping;
    await control.run("schedule"); expect(work).toHaveBeenCalledTimes(1);
  });
  it("ingests into the live SQLite API repository, fuzzy search updates immediately, repeat run skips files", async () => {
    const config = loadConfig({ DB_DRIVER: "sqlite", SQLITE_PATH: ":memory:" });
    const storage = await openStorage(config);
    try {
      await storage.migrate();
      const src = new MockSource("rami-levy", "רמי לוי");
      const id = "7290058140886";
      const time = new Date();
      src.add("Stores-test.gz", "stores", id, "000", null, time, storesXml(id, [{ sub: "1", id: "39", name: "אונליין", city: "", address: "", type: 2 }]));
      src.add("PriceFull-test.gz", "pricefull", id, "1", "39", time, priceXml(id, "1", "39", [{ code: gtin13("729001000001"), name: "חלב תנובה 3% ליטר", price: 7.1 }]));
      const control = createAutoIngest(() => runDailyIngest({ repo: storage.repo, config, sources: [src], retry: { attempts: 1, baseDelayMs: 0, factor: 4 } }), () => {});
      const app = createApp(new PriceService(storage.repo), config, { ingestStatus: control.status });
      const search = async () => (await (await app.request("/products/search?q=" + encodeURIComponent("חלב תנווה"))).json()).results;
      expect(await search()).toHaveLength(0);
      await control.run("startup");
      expect(control.status().phase).toBe("ok");
      expect(await search()).toHaveLength(1);
      await control.run("schedule");
      expect(control.status().report?.chains[0]?.filesSkipped).toBe(1);
      expect(control.status().report?.chains[0]?.filesIngested).toBe(0);
      expect(await search()).toHaveLength(1);
    } finally { await storage.close(); }
  });
  it("disabled means no network work", async () => {
    const work = vi.fn(async () => report());
    const control = createAutoIngest(work, () => {}, false);
    await control.run("startup");
    expect(work).not.toHaveBeenCalled(); expect(control.status().phase).toBe("disabled");
  });
});
