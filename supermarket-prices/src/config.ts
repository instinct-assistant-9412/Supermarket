export interface Config {
  databaseUrl: string;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? "postgres://prices:prices@localhost:5432/prices",
    apiPort: num(env.PORT, 3000),
    fuzzyAutoThreshold: num(env.FUZZY_AUTO_THRESHOLD, 0.8),
    fuzzyReviewThreshold: num(env.FUZZY_REVIEW_THRESHOLD, 0.55),
    maxPriceIls: num(env.MAX_PRICE_ILS, 10000),
    maxFileAgeHours: num(env.MAX_FILE_AGE_HOURS, 36),
    userAgent: env.USER_AGENT ?? "supermarket-prices/0.1 (+research)",
  };
}
