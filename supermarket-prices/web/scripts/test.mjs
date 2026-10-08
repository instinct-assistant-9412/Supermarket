import { spawnSync } from 'node:child_process';
// Pass this to Vitest workers too, not just the parent process (Node 26 global Web Storage).
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --no-experimental-webstorage`.trim() };
const result = spawnSync(process.execPath, ['./node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
