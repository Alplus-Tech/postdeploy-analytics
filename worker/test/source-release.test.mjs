import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { validatePath } from '../scripts/source-release.mjs';

test('release rejects excluded paths, traversal and nonregular source inputs before writing output', () => {
  for (const path of ['../secret','/tmp/key','demo/../../key','.git/config','AGENTS.md','docs/agents/a.md','.dev.vars','.env.production','a.sqlite','a.map','demo//a']) assert.throws(() => validatePath(path));
  for (const path of ['.dev.vars.example','demo/fonts/OFL.txt','worker/src/index.ts']) validatePath(path);
  mkdirSync('.scratch/source-distribution', {recursive:true});
  const root=mkdtempSync('.scratch/source-distribution/boundary-');
  mkdirSync(root+'/worker/scripts',{recursive:true});
  copyFileSync('worker/scripts/source-release.mjs', root+'/worker/scripts/source-release.mjs');
  writeFileSync(root+'/SOURCE_MANIFEST.json', JSON.stringify({revision:'a'.repeat(40)}));
  writeFileSync(root+'/release-files.json', JSON.stringify(['linked']));
  symlinkSync(resolve('LICENSE'), root+'/linked');
  let result=spawnSync(process.execPath,['worker/scripts/source-release.mjs'],{cwd:root,encoding:'utf8',timeout:5000});
  assert.notEqual(result.status,0); assert.match(result.stderr,/symlink refused/);
  writeFileSync(root+'/release-files.json', JSON.stringify(['worker']));
  result=spawnSync(process.execPath,['worker/scripts/source-release.mjs'],{cwd:root,encoding:'utf8',timeout:5000});
  assert.notEqual(result.status,0); assert.match(result.stderr,/must be regular/);
  execFileSync(process.execPath,['worker/scripts/dependency-inventory.mjs','--check']);
});
