import type { Config } from "../config.js";
import type { FreshnessRow, IngestRunInfo } from "../ingest/repository.js";

export interface FileStats {
  expectedChainId: string | null;
  fileChainId: string;
  itemsTotal: number;
  itemsInvalid: number;
  duplicates: number;
  gtinMatched: number;
  fileTime: Date | null;
}

export interface QualityIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
}

/** Per-file checks run on every ingest. Pure function, easy to unit test. */
export function checkFile(stats: FileStats, prev: IngestRunInfo | null, cfg: Pick<Config, "maxFileAgeHours">, now = new Date()): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (stats.itemsTotal === 0) {
    issues.push({ code: "EMPTY_FILE", severity: "error", message: "הקובץ לא הכיל מוצרים תקינים" });
    return issues;
  }
  if (stats.expectedChainId && stats.fileChainId && stats.expectedChainId !== stats.fileChainId) {
    issues.push({ code: "CHAIN_MISMATCH", severity: "error", message: `ChainId בקובץ (${stats.fileChainId}) שונה מהצפוי (${stats.expectedChainId})` });
  }
  const invalidRate = stats.itemsInvalid / (stats.itemsTotal + stats.itemsInvalid);
  if (invalidRate > 0.02) {
    issues.push({ code: "HIGH_INVALID_RATE", severity: "warning", message: `${(invalidRate * 100).toFixed(1)}% מהשורות לא תקינות (מחיר חסר/לא סביר)` });
  }
  const gtinShare = stats.gtinMatched / stats.itemsTotal;
  if (gtinShare < 0.5) {
    issues.push({ code: "LOW_GTIN_SHARE", severity: "warning", message: `רק ${(gtinShare * 100).toFixed(0)}% מהמוצרים עם ברקוד תקין` });
  }
  if (stats.duplicates / stats.itemsTotal > 0.01) {
    issues.push({ code: "DUPLICATE_ITEMS", severity: "warning", message: `${stats.duplicates} קודי מוצר כפולים בקובץ` });
  }
  if (prev && prev.itemsTotal > 0 && stats.itemsTotal < prev.itemsTotal * 0.6) {
    issues.push({ code: "ROW_DROP", severity: "warning", message: `ירידה חדה במספר המוצרים: ${prev.itemsTotal} -> ${stats.itemsTotal}` });
  }
  if (stats.fileTime && now.getTime() - stats.fileTime.getTime() > cfg.maxFileAgeHours * 3600_000) {
    issues.push({ code: "STALE_FILE", severity: "warning", message: `הקובץ ישן מ-${cfg.maxFileAgeHours} שעות` });
  }
  return issues;
}

export interface ChainFreshness {
  chainId: string;
  chainName: string | null;
  status: "fresh" | "stale" | "never";
  ageHours: number | null;
  stores: number;
  currentPrices: number;
}

/** Cross-chain freshness view over what is stored (run daily; exposed on /quality and by the CLI). */
export function evaluateFreshness(rows: FreshnessRow[], cfg: Pick<Config, "maxFileAgeHours">, now = new Date()): ChainFreshness[] {
  return rows.map((r) => {
    const ref = r.lastFileTime ?? r.lastIngestAt;
    const age = ref ? (now.getTime() - ref.getTime()) / 3600_000 : null;
    return {
      chainId: r.chainId,
      chainName: r.chainName,
      status: age === null ? "never" : age > cfg.maxFileAgeHours ? "stale" : "fresh",
      ageHours: age === null ? null : Math.round(age * 10) / 10,
      stores: r.stores,
      currentPrices: r.currentPrices,
    };
  });
}
