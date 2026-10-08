export interface Config {
  /** sqlite = הרצה מקומית בלי Postgres. pg = Postgres (production). */
  dbDriver: "sqlite" | "pg";
  databaseUrl: string;
  /** נתיב קובץ ה-SQLite (או :memory:) */
  sqlitePath: string;
  apiPort: number;
  /** minimum trigram similarity for an automatic cross-chain name match */
  fuzzyAutoThreshold: number;
  /** below auto but above this -> new product + flagged for review */
  fuzzyReviewThreshold: number;
  maxPriceIls: number;
  maxFileAgeHours: number;
  userAgent: string;
}

function num(v: string | undefined, d: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

function driverFrom(env: NodeJS.ProcessEnv): "sqlite" | "pg" {
  const v = env.DB_DRIVER?.trim().toLowerCase();
  if (v === "sqlite" || v === "pg") return v;
  if (v) throw new Error(`DB_DRIVER must be "sqlite" or "pg" (got "${v}")`);
  return env.DATABASE_URL ? "pg" : "sqlite";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dbDriver: driverFrom(env),
    databaseUrl: env.DATABASE_URL ?? "postgres://prices:prices@localhost:5432/prices",
    sqlitePath: env.SQLITE_PATH ?? "data/prices.db",
    apiPort: num(env.PORT, 3000),
    fuzzyAutoThreshold: num(env.FUZZY_AUTO_THRESHOLD, 0.8),
    fuzzyReviewThreshold: num(env.FUZZY_REVIEW_THRESHOLD, 0.55),
    maxPriceIls: num(env.MAX_PRICE_ILS, 10000),
    maxFileAgeHours: num(env.MAX_FILE_AGE_HOURS, 36),
    userAgent: env.USER_AGENT ?? "supermarket-prices/0.1 (+research)",
  };
}
