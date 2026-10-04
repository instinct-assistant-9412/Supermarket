import { describe, expect, it } from "vitest";
import { ingestChainWithRetry, runDailyIngest, type DailyIngestDeps } from "../src/scheduler/dailyIngest.js";
import { loadScheduleConfig } from "../src/scheduler/schedule.js";
import type { SourceIngestSummary } from "../src/ingest/ingest.js";
import { MemoryRepository } from "../src/ingest/memoryRepository.js";
import { loadConfig } from "../src/config.js";
import { MockSource, gtin13, priceXml, storesXml } from "./helpers.js";

const config = loadConfig({});
const ok = (key: string, n = 2): SourceIngestSummary => ({ source: key, filesSeen: n, filesIngested: n, filesSkipped: 0, failures: [], runs: [] });

function deps(over: Partial<DailyIngestDeps> & { sources: MockSource[] }): { d: DailyIngestDeps; sleeps: number[]; logs: string[] } {
  const sleeps: number[] = [];
  const logs: string[] = [];
  const d: DailyIngestDeps = {
    repo: new MemoryRepository(),
    config,
    retry: { attempts: 3, baseDelayMs: 1000, factor: 4 },
    sleep: async (ms) => void sleeps.push(ms),
    log: (l) => void logs.push(l),
    ...over,
  };
  return { d, sleeps, logs };
}

describe("daily ingest scheduler logic", () => {
  it("one dead chain does not stop the others", async () => {
    const sources = [new MockSource("shufersal", "שופרסל"), new MockSource("victory", "ויקטורי"), new MockSource("carrefour", "קרפור")];
    const { d } = deps({
      sources,
      ingest: async (_r, s) => {
        if (s.key === "victory") throw new Error("ETIMEDOUT");
        return ok(s.key);
      },
    });
    const report = await runDailyIngest(d);
    expect(report.chains.map((c) => [c.chain, c.status])).toEqual([["shufersal", "ok"], ["victory", "failed"], ["carrefour", "ok"]]);
    expect(report.chains[1]!.error).toBe("ETIMEDOUT");
    expect(report.chains[1]!.attempts).toBe(3);
  });

  it("retries with exponential backoff and recovers", async () => {
    let calls = 0;
    const { d, sleeps } = deps({
      sources: [],
      ingest: async (_r, s) => {
        if (++calls < 3) throw new Error("503");
        return ok(s.key);
      },
    });
    const r = await ingestChainWithRetry(new MockSource("rami-levy", "רמי לוי"), d);
    expect(r.status).toBe("ok");
    expect(r.attempts).toBe(3);
    expect(sleeps).toEqual([1000, 4000]);
  });

  it("does not retry after success and does not sleep after the last attempt", async () => {
    let calls = 0;
    const { d, sleeps } = deps({ sources: [], ingest: async (_r, s) => (calls++, ok(s.key)) });
    expect((await ingestChainWithRetry(new MockSource("a", "a"), d)).attempts).toBe(1);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);

    const { d: d2, sleeps: s2 } = deps({ sources: [], ingest: async () => { throw new Error("x"); } });
    expect((await ingestChainWithRetry(new MockSource("b", "b"), d2)).status).toBe("failed");
    expect(s2).toHaveLength(2);
  });

  it("all files failing counts as failure (retried); some failing is partial (not retried)", async () => {
    const allBad: SourceIngestSummary = { source: "x", filesSeen: 2, filesIngested: 0, filesSkipped: 0, failures: [{ file: "a", error: "bad gz" }, { file: "b", error: "bad gz" }], runs: [] };
    const some: SourceIngestSummary = { ...ok("y"), filesIngested: 1, failures: [{ file: "a", error: "bad gz" }] };
    let n = 0;
    const { d } = deps({ sources: [], ingest: async (_r, s) => (s.key === "x" ? (n++, allBad) : some) });
    const rx = await ingestChainWithRetry(new MockSource("x", "x"), d);
    expect([rx.status, rx.attempts, n]).toEqual(["failed", 3, 3]);
    const ry = await ingestChainWithRetry(new MockSource("y", "y"), d);
    expect([ry.status, ry.attempts, ry.fileFailures]).toEqual(["partial", 1, 1]);
  });

  it("a freshness check failure is reported, not thrown", async () => {
    const repo = new MemoryRepository();
    repo.freshness = async () => { throw new Error("db down"); };
    const { d } = deps({ sources: [new MockSource("a", "a")], repo, ingest: async (_r, s) => ok(s.key) });
    const report = await runDailyIngest(d);
    expect(report.freshnessError).toBe("db down");
    expect(report.chains[0]!.status).toBe("ok");
  });

  it("end to end with the real ingest: working chain ingests, broken chain is isolated, freshness is evaluated", async () => {
    const chain = "7290058140886";
    const good = new MockSource("rami-levy", "רמי לוי");
    const t = new Date();
    good.add(`Stores${chain}-000-20261004-0500.xml`, "stores", chain, "001", null, t, storesXml(chain, [{ sub: "001", id: "039", name: "מרלוג אינטרנט", city: "0", address: "-", type: 2 }]));
    good.add(`pricefull${chain}-039-202610040300.gz`, "pricefull", chain, "001", "039", t, priceXml(chain, "001", "039", [{ code: gtin13("729001000001"), name: "חלב תנובה 3% 1 ליטר", price: 7.2 }]));
    const dead = new MockSource("victory", "ויקטורי");
    dead.listFiles = async () => { throw new Error("ECONNREFUSED"); };
    const repo = new MemoryRepository();
    const { d } = deps({ sources: [dead, good], repo });
    const report = await runDailyIngest({ ...d, sources: [dead, good] });
    expect(report.chains.map((c) => [c.chain, c.status, c.filesIngested])).toEqual([["victory", "failed", 0], ["rami-levy", "ok", 1]]);
    expect(report.freshness.find((f) => f.chainId === chain)?.status).toBe("fresh");
    // second run the same day: file already ingested -> skipped, still ok
    const again = await runDailyIngest({ ...d, sources: [good] });
    expect([again.chains[0]!.status, again.chains[0]!.filesSkipped]).toEqual(["ok", 1]);
  });
});

describe("schedule config", () => {
  it("defaults to 06:00 Israel time", () => {
    const c = loadScheduleConfig({});
    expect([c.cron, c.timezone, c.runOnStart, c.attempts]).toEqual(["0 6 * * *", "Asia/Jerusalem", false, 3]);
  });
  it("INGEST_HOUR / INGEST_MINUTE change the time; bad values fall back", () => {
    expect(loadScheduleConfig({ INGEST_HOUR: "4", INGEST_MINUTE: "30" }).cron).toBe("30 4 * * *");
    expect(loadScheduleConfig({ INGEST_HOUR: "25" }).cron).toBe("0 6 * * *");
  });
  it("INGEST_CRON overrides everything", () => {
    expect(loadScheduleConfig({ INGEST_CRON: "0 */6 * * *", INGEST_HOUR: "4" }).cron).toBe("0 */6 * * *");
  });
});
