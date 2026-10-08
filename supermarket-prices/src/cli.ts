import { loadConfig } from "./config.js";
import { openStorage } from "./db/storage.js";
import { configuredSources, sourceByKey } from "./downloader/registry.js";
import { ingestSource } from "./ingest/ingest.js";
import { evaluateFreshness } from "./quality/checks.js";

const [cmd, ...args] = process.argv.slice(2);
const config = loadConfig();
const http = { userAgent: config.userAgent };

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const storage = await openStorage(config);
  const repo = storage.repo;
  await storage.migrate(); // idempotent; sqlite: no-op (schema created on open)
  let failed = false;
  try {
    if (cmd === "migrate") {
      console.log(`schema ready (${storage.driver})`);
    } else if (cmd === "ingest") {
      const chain = flag("chain");
      const maxFiles = flag("max-files") ? Number(flag("max-files")) : undefined;
      const kinds = flag("kind") === "price" ? (["price"] as const) : (["pricefull"] as const);
      const sources = chain ? [sourceByKey(chain, http)].filter((s) => s !== undefined) : configuredSources(http, config.onlineOnly);
      if (config.onlineOnly && sources.some((s) => !["rami-levy", "carrefour", "shufersal", "victory"].includes(s.key))) throw new Error("chain outside online scope; use ONLINE_ONLY=false for legacy mode");
      if (sources.length === 0) throw new Error(`unknown chain: ${chain}`);
      for (const s of sources) {
        try {
          const sum = await ingestSource(repo, s, { config, kinds: [...kinds], maxFiles, onlineOnly: config.onlineOnly || args.includes("--online") });
          if (sum.failures.length) failed = true;
          console.log(`${s.key}: ingested ${sum.filesIngested}, skipped ${sum.filesSkipped}, failures ${sum.failures.length}`);
          for (const r of sum.runs.filter((x) => x.issues.length)) console.log(`  ${r.fileName}: ${r.issues.join(" | ")}`);
          for (const f of sum.failures) console.log(`  FAIL ${f.file}: ${f.error}`);
        } catch (e) {
          failed = true;
          console.log(`${s.key}: FAILED ${(e as Error).message}`);
        }
      }
    } else if (cmd === "quality") {
      for (const c of evaluateFreshness(await repo.freshness(), config)) {
        console.log(`${c.chainId} ${c.chainName ?? ""}: ${c.status} age=${c.ageHours ?? "-"}h stores=${c.stores} prices=${c.currentPrices}`);
      }
    } else {
      console.log("usage: cli.ts migrate | ingest [--chain key] [--max-files N] [--kind pricefull|price] | quality");
    }
    if (failed) process.exitCode = 1;
  } finally {
    await storage.close();
  }
}

await main();
