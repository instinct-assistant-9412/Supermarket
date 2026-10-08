import { describe, expect, it } from "vitest";
import { checkFile, evaluateFreshness } from "../src/quality/checks.js";

const cfg = { maxFileAgeHours: 36 };
const base = { expectedChainId: "1", fileChainId: "1", itemsTotal: 100, itemsInvalid: 0, duplicates: 0, gtinMatched: 90, fileTime: new Date("2026-10-04T10:00:00Z") };
const now = new Date("2026-10-04T12:00:00Z");
const codes = (s: Parameters<typeof checkFile>[0], prev = null as Parameters<typeof checkFile>[1]) => checkFile(s, prev, cfg, now).map((i) => i.code);

describe("quality checks", () => {
  it("passes a healthy file", () => expect(codes(base)).toEqual([]));
  it("flags empty, wrong chain, invalid rows, low gtin share, duplicates, stale", () => {
    expect(codes({ ...base, itemsTotal: 0 })).toEqual(["EMPTY_FILE"]);
    expect(codes({ ...base, fileChainId: "2" })).toContain("CHAIN_MISMATCH");
    expect(codes({ ...base, itemsInvalid: 10 })).toContain("HIGH_INVALID_RATE");
    expect(codes({ ...base, gtinMatched: 10 })).toContain("LOW_GTIN_SHARE");
    expect(codes({ ...base, duplicates: 5 })).toContain("DUPLICATE_ITEMS");
    expect(codes({ ...base, fileTime: new Date("2026-10-01T00:00:00Z") })).toContain("STALE_FILE");
  });
  it("flags a sharp row drop versus the previous run", () => {
    const prev = { itemsTotal: 1000 } as Parameters<typeof checkFile>[1];
    expect(codes({ ...base, itemsTotal: 100 }, prev)).toContain("ROW_DROP");
    expect(codes({ ...base, itemsTotal: 900 }, prev)).not.toContain("ROW_DROP");
  });
  it("classifies chain freshness", () => {
    const rows = [
      { chainId: "a", chainName: "A", stores: 1, currentPrices: 1, lastFileTime: new Date("2026-10-04T10:00:00Z"), lastIngestAt: null },
      { chainId: "b", chainName: "B", stores: 1, currentPrices: 1, lastFileTime: new Date("2026-09-20T10:00:00Z"), lastIngestAt: null },
      { chainId: "c", chainName: "C", stores: 0, currentPrices: 0, lastFileTime: null, lastIngestAt: null },
    ];
    expect(evaluateFreshness(rows, cfg, now).map((r) => r.status)).toEqual(["fresh", "stale", "never"]);
  });
});
