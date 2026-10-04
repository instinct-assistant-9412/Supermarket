import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db/pool.js";
import { PgRepository } from "./db/pgRepository.js";
import { allSources, sourceByKey } from "./downloader/registry.js";
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
  const pool = createPool(config.databaseUrl);
  const repo = new PgRepository(pool);
  try {
    if (cmd === "migrate") {
      await migrate(pool);
      console.log("schema ready");
    } else if (cmd === "ingest") {
      const chain = flag("chain");
      const maxFiles = flag("max-files") ? Number(flag("max-files")) : undefined;
      const kinds = flag("kind") === "price" ? (["price"] as const) : (["pricefull"] as const);
      const sources = chain ? [sourceByKey(chain, http)].filter((s) => s !== undefined) : allSources(http);
      if (sources.length === 0) throw new Error(`unknown chain: ${chain}`);
      for (const s of sources) {
        try {
          const sum = await ingestSource(repo, s, { config, kinds: [...kinds], maxFiles, onlineOnly: args.includes("--online") });
          console.log(`${s.key}: ingested ${sum.filesIngested}, skipped ${sum.filesSkipped}, failures ${sum.failures.length}`);
          for (const r of sum.runs.filter((x) => x.issues.length)) console.log(`  ${r.fileName}: ${r.issues.join(" | ")}`);
          for (const f of sum.failures) console.log(`  FAIL ${f.file}: ${f.error}`);
        } catch (e) {
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
  } finally {
    await pool.end();
  }
}

await main();
