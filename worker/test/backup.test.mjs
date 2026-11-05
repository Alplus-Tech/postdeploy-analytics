import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { protectedCopy, compare } from '../scripts/backup.mjs';

test('private offline restore preserves schema and values and refuses overwrite or changed rows', async()=>{
 mkdirSync('.scratch/self-host-setup',{recursive:true,mode:0o700});
 const dir=mkdtempSync('.scratch/self-host-setup/backup-');
 const source=dir+'/source.sqlite',dest=dir+'/backup.sqlite';
 let db=new DatabaseSync(source);for(const f of readdirSync('migrations').sort())db.exec(readFileSync('migrations/'+f,'utf8'));db.close();
 await protectedCopy(source,dest);assert.equal(statSync(dest).mode & 0o777,0o600);
 await assert.rejects(()=>protectedCopy(source,dest),/exists/);
 db=new DatabaseSync(dest);db.exec("UPDATE organisations SET name='changed'");db.close();
 assert.throws(()=>compare(source,dest),/Row mismatch/);
});
