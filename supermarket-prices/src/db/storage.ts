import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import type { Repository } from "../ingest/repository.js";

export interface Storage {
  driver: "sqlite" | "pg";
  repo: Repository;
  /** pg: יוצר/מעדכן סכמה. sqlite: הסכמה כבר נוצרה בפתיחה. בטוח להריץ שוב. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const ONLINE_CHAINS = [["7290058140886", "רמי לוי"], ["7290055700007", "קרפור / יינות ביתן"], ["7290027600007", "שופרסל"], ["7290696200003", "ויקטורי"]] as const;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * בחירת מנוע האחסון לפי הגדרות (ראו config.ts): DB_DRIVER=sqlite|pg.
 * ללא DB_DRIVER: אם DATABASE_URL מוגדר -> pg, אחרת sqlite (הרצה מקומית בלי התקנות).
 * הספריות נטענות בדינמיות, כך שמצב אחד לא דורש את החבילה של השני.
 */
export async function openStorage(config: Pick<Config, "dbDriver" | "databaseUrl" | "sqlitePath"> & { onlineOnly?: boolean }): Promise<Storage> {
  if (config.dbDriver === "sqlite") {
    const { default: Database } = await import("better-sqlite3");
    const { SqliteRepository } = await import("./sqliteRepository.js");
    if (config.sqlitePath !== ":memory:") mkdirSync(dirname(config.sqlitePath), { recursive: true });
    const db = new Database(config.sqlitePath);
    const repo = new SqliteRepository(db, readFileSync(join(here, "schema.sqlite.sql"), "utf8"), config.onlineOnly ?? true);
    return { driver: "sqlite", repo, migrate: async () => {
      if (config.onlineOnly ?? true) {
        for (const [id, name] of ONLINE_CHAINS) await repo.upsertChain(id, name);
      }
    }, close: async () => void db.close() };
  }
  const { createPool, migrate } = await import("./pool.js");
  const { PgRepository } = await import("./pgRepository.js");
  const pool = createPool(config.databaseUrl);
  const repo = new PgRepository(pool, config.onlineOnly ?? true);
  return { driver: "pg", repo, migrate: async () => {
    await migrate(pool);
    if (config.onlineOnly ?? true) for (const [id, name] of ONLINE_CHAINS) await repo.upsertChain(id, name);
  }, close: () => pool.end() };
}
