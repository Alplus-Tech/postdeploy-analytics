import test from 'node:test';
import assert from 'node:assert/strict';
import { deploy } from '../scripts/deploy.mjs';

test('Deploy button refuses the unprovisioned source template without remote operations', () => {
  const calls=[];
  const run=(...args)=>calls.push(args);
  assert.throws(()=>deploy([], {name:'postdeploy-analytics',d1_databases:[{binding:'DB',database_id:'00000000-0000-0000-0000-000000000000'}]},run), /not provisioned/);
  assert.equal(calls.length,0);
  assert.throws(()=>deploy(['--remote'],{},run),/guided/);
  assert.equal(calls.length,0);
});

test('Provisioned template builds and migrates the binding before uploading, independent of chosen database name', () => {
  const calls=[];
  deploy([], {name:'postdeploy-example',d1_databases:[{binding:'DB',database_name:'renamed-by-installer',database_id:'12345678-1234-1234-1234-123456789abc'}]},(command,args)=>calls.push({command,args}));
  assert.deepEqual(calls.map(c=>c.args.slice(0,5)),[['run','build'],['d1','migrations','apply','DB','--remote'],['deploy','--config',calls[2].args[2]]]);
  assert.ok(!JSON.stringify(calls).includes('renamed-by-installer'));
});
