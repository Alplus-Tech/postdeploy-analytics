import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { selfHost, processAdapter } from '../scripts/self-host.mjs';

test('setup keeps identity private, plans without remote execution and resumes ambiguous creation without duplication', () => {
  const name = 'postdeploy-test-' + Date.now();
  const base = ['--name', name];
  const calls = [];
  const id = '12345678-1234-1234-1234-123456789abc';
  let databases = [], fail = true;
  const run = (command, args, input) => {
    calls.push({command, args, input});
    if (args[0] === 'd1' && args[1] === 'list') return JSON.stringify(databases);
    if (args[1] === 'create') { databases = [{name, uuid:id}]; if (fail) throw Error('interrupted'); }
    return '';
  };
  assert.throws(()=>selfHost(['init', '--name','../escape']));
  assert.throws(()=>selfHost(['init',...base,'--account','1'.repeat(32),'--origin','https://example.com/path','--sender','a@example.com']));
  selfHost(['init',...base,'--account','1'.repeat(32),'--origin','https://example.com','--sender','a@example.com'],run);
  assert.throws(()=>selfHost(['init',...base,'--account','1'.repeat(32),'--origin','https://example.com','--sender','a@example.com'],run));
  selfHost(['plan',...base],run); selfHost(['deploy',...base],run);
  assert.equal(calls.length,0);
  const execute = [...base,'--execute',name];
  assert.throws(()=>selfHost(['provision',...execute],run),/interrupted/);
  fail=false;
  assert.throws(()=>selfHost(['provision',...execute],run),/already exists/);
  selfHost(['provision',...execute,'--database-id',id],run);
  selfHost(['provision',...execute],run);
  assert.equal(calls.filter(c=>c.args[1]==='create').length,1);
  assert.throws(()=>selfHost(['secret',...execute],run),/ownership/);
  const confirmed=[...execute,'--confirm-worker',name];
  selfHost(['secret',...confirmed],run); selfHost(['secret',...confirmed],run);
  const secrets=calls.filter(c=>c.args[0]==='secret');
  assert.equal(secrets[0].input,secrets[1].input);
  assert.match(secrets[0].input,/^[a-f0-9]{64}\n$/);
  assert.ok(!JSON.stringify(secrets[0].args).includes(secrets[0].input.trim()));
  assert.equal(statSync(`.self-host/${name}/bootstrap.secret`).mode & 0o777,0o600);
  selfHost(['deploy',...confirmed],run);
  const tail=calls.slice(-4).map(c=>c.args.slice(0,5));
  assert.deepEqual(tail.map(a=>a.slice(0,2)),[['run','build'],['d1','migrations'],['d1','migrations'],['deploy','--config']]);
  assert.ok(tail[2].includes('--remote'));
  selfHost(['seal',...confirmed],run);
  assert.equal(calls.at(-1).args[1],'delete');
  assert.ok(existsSync(`.self-host/${name}/bootstrap.secret`));
  assert.equal(JSON.parse(readFileSync(`.self-host/${name}/wrangler.json`)).d1_databases[0].database_id,id);
  assert.throws(()=>processAdapter(process.execPath,['-e','process.stderr.write("sensitive-value"); process.exit(1)']),e=>!e.message.includes('sensitive-value'));
});
