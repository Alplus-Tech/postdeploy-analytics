import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const lockBytes = readFileSync('package-lock.json');
const lock = JSON.parse(lockBytes);
const packages = Object.entries(lock.packages).filter(([path]) => path).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([path, p]) => ({
  path, name: p.name ?? path.split('node_modules/').at(-1), version: p.version,
  license: p.license ?? 'UNKNOWN', source: p.resolved ?? 'UNKNOWN', integrity: p.integrity ?? 'UNKNOWN',
  scope: path === 'node_modules/bcryptjs' ? 'Worker runtime (bundled after install)' : 'build/test/deploy tooling; not included in source archive or product assets',
  optional: p.optional === true,
}));
const result = JSON.stringify({ lockSha256: createHash('sha256').update(lockBytes).digest('hex'), evidence: 'Exact npm lock metadata; source is registry tarball URL, not an independently verified upstream repository. Optional platform packages included. License declarations are not a full audit of tooling bundled internals.', packages }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync('licenses/dependencies.json', 'utf8') !== result) throw Error('Dependency inventory differs from lock; regenerate it');
} else writeFileSync('licenses/dependencies.json', result);
