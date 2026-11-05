import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selfHost, processAdapter } from './self-host.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function deploy(args, config, run = processAdapter) {
  if (args.length) {
    if (!args.includes('--name')) throw new Error('Use the guided --name installation flow or run without arguments for a configured Cloudflare template.');
    return selfHost(['deploy', ...args], run);
  }
  const binding = config.d1_databases?.find(b => b.binding === 'DB');
  if (!binding || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(binding.database_id ?? '') || binding.database_id === '00000000-0000-0000-0000-000000000000') {
    throw new Error('D1 is not provisioned. Start with Deploy to Cloudflare or the guided setup; never deploy the placeholder binding.');
  }
  if (!/^postdeploy-[a-z0-9-]+$/.test(config.name ?? '')) throw new Error('Choose a Worker name beginning postdeploy-.');
  const file = resolve(root, 'wrangler.jsonc');
  const wrangler = resolve(root, 'node_modules/.bin/wrangler');
  run('npm', ['run', 'build']);
  run(wrangler, ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', file]);
  run(wrangler, ['deploy', '--config', file]);
  return 'Deployed configured template. Verify APP_ORIGIN, create the first administrator at /auth using BOOTSTRAP_SECRET, then remove that secret.';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(deploy(process.argv.slice(2), JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')))); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Deployment failed'); process.exitCode = 1; }
}
