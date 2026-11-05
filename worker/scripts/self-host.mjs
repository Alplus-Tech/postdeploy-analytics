import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, realpathSync, renameSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const placeholder = '00000000-0000-0000-0000-000000000000';
export function processAdapter(command, args, input) {
  const configIndex = args.indexOf('--config');
  const account = configIndex >= 0 ? JSON.parse(readFileSync(args[configIndex + 1], 'utf8')).account_id : undefined;
  const result = spawnSync(command, args, { cwd: root, input, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...(account ? { CLOUDFLARE_ACCOUNT_ID: account } : {}) }, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed; output withheld because it may contain credentials. Resolve account/configuration errors externally, then retry.`);
  return result.stdout;
}
function privateDir(name) {
  const base = resolve(root, '.self-host');
  if (existsSync(base) && (lstatSync(base).isSymbolicLink() || (lstatSync(base).mode & 0o077))) throw new Error('.self-host must be a private real directory (0700)');
  if (!existsSync(base)) mkdirSync(base, { mode: 0o700 });
  const dir = resolve(base, name);
  if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink() || (lstatSync(dir).mode & 0o077) || realpathSync(dir) !== dir) throw new Error('Unsafe installation path');
  return dir;
}
function save(file, value, fresh = false) {
  if (fresh) writeFileSync(file, value, { flag: 'wx', mode: 0o600 });
  else {
    const temp = file + '.next';
    writeFileSync(temp, value, { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
  }
}
function read(file) {
  if (lstatSync(file).isSymbolicLink() || (lstatSync(file).mode & 0o077)) throw new Error('Unsafe private file');
  return readFileSync(file, 'utf8');
}
export function selfHost(argv, run = processAdapter) {
  const [action, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--') || rest[i] in options) throw new Error('Options require unique --key value pairs');
    options[rest[i]] = rest[i + 1];
  }
  const allowed = new Set(['--name', '--origin', '--sender', '--account', '--database-id', '--execute', '--confirm-worker']);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new Error(`Unknown option ${key}`);
  const name = options['--name'];
  if (!/^postdeploy-[a-z0-9](?:[a-z0-9-]{0,36}[a-z0-9])?$/.test(name ?? '')) throw new Error('Use --name postdeploy-<lowercase installation slug> (maximum 49 characters)');
  if (!['init', 'plan', 'provision', 'local', 'deploy', 'secret', 'seal', 'dry-run'].includes(action)) throw new Error('Commands: init, plan, provision, local, dry-run, secret, deploy, seal');
  if (action !== 'init' && ['--origin', '--sender', '--account'].some(k => options[k])) throw new Error('Installation identity is immutable; create another name instead');
  const dir = privateDir(name), configFile = resolve(dir, 'wrangler.json');
  if (action === 'init') {
    const origin = options['--origin'], sender = options['--sender'], account = options['--account'];
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.hostname === 'localhost' || url.username || url.password) throw new Error('Use an exact public HTTPS --origin without trailing slash');
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(sender ?? '')) throw new Error('Invalid --sender address');
    if (!/^[a-f0-9]{32}$/.test(account ?? '')) throw new Error('Use the intended 32-hex Cloudflare --account ID');
    const config = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'));
    Object.assign(config, { name, account_id: account, main: '../../worker/src/index.ts', $schema: '../../node_modules/wrangler/config-schema.json' });
    config.assets.directory = '../../demo';
    config.d1_databases = [{ binding: 'DB', database_name: name, database_id: placeholder, migrations_dir: '../../migrations' }];
    config.vars = { ENVIRONMENT: 'production', APP_ORIGIN: origin, EMAIL_FROM: sender };
    if (existsSync(configFile)) throw new Error('Installation already exists; use plan (never overwrites)');
    save(configFile, JSON.stringify(config, null, 2) + '\n', true);
    return `Created private configuration. Next: npm run setup -- plan --name ${name}`;
  }
  const config = JSON.parse(read(configFile));
  const binding = config.d1_databases?.[0];
  if (config.name !== name || !/^[a-f0-9]{32}$/.test(config.account_id) || binding?.binding !== 'DB' || binding.database_name !== name || !uuid.test(binding.database_id)) throw new Error('Configuration identity mismatch');
  const wrangler = (...args) => run(resolve(root, 'node_modules/.bin/wrangler'), [...args, '--config', configFile]);
  const target = `Worker ${name}; account ${config.account_id}; D1 ${binding.database_name} (${binding.database_id}); origin ${config.vars.APP_ORIGIN}`;
  if (action === 'plan') return `${target}\nRemote sequence: provision → secret → deploy → owner setup at /auth → seal.\nLocal: local → wrangler dev with this config and explicit loopback vars.\nRecommended: compact conversion before first collection; see docs/operations.md. No remote command executed.`;
  if (action === 'local') {
    const vars = resolve(dir, '.dev.vars');
    if (!existsSync(vars)) save(vars, 'BOOTSTRAP_SECRET=' + randomBytes(32).toString('hex') + '\n', true);
    wrangler('d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', resolve(dir, '.wrangler/state'));
    return 'Local migrations applied; no remote resources changed.';
  }
  if (action === 'dry-run') {
    run('npm', ['run', 'build']);
    wrangler('deploy', '--dry-run', '--outdir', resolve(dir, 'bundle'));
    return 'Local bundle validated; no deployment.';
  }
  if (options['--execute'] !== name) return `${target}\nNo remote command executed. Add --execute ${name} to explicitly run ${action}.`;
  if (action === 'provision') {
    const databases = JSON.parse(wrangler('d1', 'list', '--json'));
    const matches = databases.filter(d => d.name === name);
    if (binding.database_id !== placeholder) {
      if (matches.length !== 1 || matches[0].uuid !== binding.database_id) throw new Error('Bound database not found in target account; refusing replacement');
      return 'Existing binding verified; nothing created.';
    }
    const adopt = options['--database-id'];
    if (adopt) {
      if (!uuid.test(adopt) || adopt === placeholder || matches.length !== 1 || matches[0].uuid !== adopt) throw new Error('Explicit database ID must match the unique existing installation name');
      binding.database_id = adopt;
    } else {
      if (matches.length) throw new Error('Name already exists; inspect ownership and explicitly resume with --database-id UUID. No duplicate created.');
      wrangler('d1', 'create', name, '--no-update-config');
      const created = JSON.parse(wrangler('d1', 'list', '--json')).filter(d => d.name === name);
      if (created.length !== 1 || !uuid.test(created[0].uuid)) throw new Error('Creation outcome ambiguous; inspect D1 list and explicitly resume with --database-id');
      binding.database_id = created[0].uuid;
    }
    save(configFile, JSON.stringify(config, null, 2) + '\n');
    return 'Database bound. Migrations/deployment remain explicit.';
  }
  if (binding.database_id === placeholder) throw new Error('Provision or explicitly bind the database first');
  const bound = JSON.parse(wrangler('d1', 'list', '--json')).filter(d => d.name === name);
  if (bound.length !== 1 || bound[0].uuid !== binding.database_id) throw new Error('Remote binding identity mismatch; refusing changes');
  if (['deploy', 'secret', 'seal'].includes(action) && options['--confirm-worker'] !== name) throw new Error('Inspect Worker ownership; provide --confirm-worker NAME to authorize changing that Worker');
  if (action === 'deploy') {
    if (options['--confirm-worker'] !== name) throw new Error('Inspect Worker name ownership first; --confirm-worker NAME authorizes replacing that Worker');
    run('npm', ['run', 'build']);
    wrangler('d1', 'migrations', 'list', 'DB', '--remote');
    wrangler('d1', 'migrations', 'apply', 'DB', '--remote');
    wrangler('deploy');
    return 'Deployed. Verify /api/health and /auth at configured origin; setup owner and seal.';
  }
  if (action === 'seal') {
    wrangler('secret', 'delete', 'BOOTSTRAP_SECRET');
    return 'Bootstrap secret removed remotely. Securely retire the local bootstrap file after confirming access. Setup stays closed; use recover for owner recovery.';
  }
  const secretFile = resolve(dir, 'bootstrap.secret');
  if (!existsSync(secretFile)) save(secretFile, randomBytes(32).toString('hex') + '\n', true);
  const secret = read(secretFile);
  if (!/^[a-f0-9]{64}\n$/.test(secret)) throw new Error('Invalid bootstrap secret file');
  run(resolve(root, 'node_modules/.bin/wrangler'), ['secret', 'put', 'BOOTSTRAP_SECRET', '--config', configFile], secret);
  return `Bootstrap secret uploaded through stdin. Read it privately from ${relative(root, secretFile)} for /auth; never paste it into commands or logs. Repeating secret reuses the same value.`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(selfHost(process.argv.slice(2))); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Setup failed'); process.exitCode = 1; }
}
