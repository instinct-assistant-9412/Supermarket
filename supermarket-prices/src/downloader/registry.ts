import type { ChainSource } from "../types.js";
import type { HttpOptions } from "./http.js";
import { PublishedPricesSource, type PublishedPricesChain } from "./publishedPrices.js";
import { CarrefourSource } from "./carrefour.js";
import { VictorySource } from "./victory.js";
import { ShufersalSource } from "./shufersal.js";

/**
 * Chains on the shared publishedprices portal. Usernames are the commonly used ones and are
 * UNVERIFIED except where noted in the README; add or fix entries after live testing.
 */
export const PUBLISHED_PRICES_CHAINS: PublishedPricesChain[] = [
  { key: "rami-levy", name: "רמי לוי", username: "RamiLevi" }, // login + file listing verified
  { key: "yohananof", name: "יוחננוף", username: "yohananof" },
  { key: "osher-ad", name: "אושר עד", username: "osherad" },
  { key: "tiv-taam", name: "טיב טעם", username: "TivTaam" },
  { key: "hazi-hinam", name: "חצי חינם", username: "HaziHinam" },
  { key: "stop-market", name: "סטופ מרקט", username: "Stop_Market" },
  { key: "politzer", name: "פוליצר", username: "politzer" },
  { key: "keshet", name: "קשת טעמים", username: "Keshet" },
  { key: "doralon", name: "דור אלון", username: "doralon" },
];

export function allSources(http: HttpOptions): ChainSource[] {
  return [new ShufersalSource(http), new CarrefourSource(http), new VictorySource(http), ...PUBLISHED_PRICES_CHAINS.map((c) => new PublishedPricesSource(c, http))];
}

export function sourceByKey(key: string, http: HttpOptions): ChainSource | undefined {
  return allSources(http).find((s) => s.key === key);
}
