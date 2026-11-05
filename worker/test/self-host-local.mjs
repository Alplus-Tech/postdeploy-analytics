import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { selfHost } from '../scripts/self-host.mjs';
import { protectedCopy, compare } from '../scripts/backup.mjs';

execFileSync('npm',['run','build'],{stdio:'pipe'});
const name = 'postdeploy-proof-' + Date.now();
selfHost(['init','--name',name,'--account','1'.repeat(32),'--origin','https://analytics.example.com','--sender','analytics@example.com']);
selfHost(['local','--name',name]);
const dir=resolve('.self-host',name), config=resolve(dir,'wrangler.json');
const wrangler=resolve('node_modules/.bin/wrangler');
const evidence=resolve('.scratch/self-host-setup',name); mkdirSync(evidence,{recursive:true,mode:0o700});
const execute=args=>execFileSync(wrangler,[...args,'--config',config],{encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
const dbFile=persist=>resolve(persist,'v3/d1/miniflare-D1DatabaseObject',readdirSync(resolve(persist,'v3/d1/miniflare-D1DatabaseObject')).find(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite'));
let server, serverLog='';
const origin='http://127.0.0.1:8797';
async function stop(){ if(server){const child=server;server=undefined;process.kill(-child.pid,'SIGTERM');await new Promise(r=>child.once('exit',r));}}
async function start(persist){
 server=spawn(wrangler,['dev','--config',config,'--local','--persist-to',persist,'--ip','127.0.0.1','--port','8797','--var','ENVIRONMENT:development','--var',`APP_ORIGIN:${origin}`],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
 for(let i=0;i<150;i++){try{if((await fetch(origin+'/api/health')).ok)return;}catch{} await new Promise(r=>setTimeout(r,200));}
 throw Error('Local Worker did not start');
}
let cookie,csrf;
async function request(path,body,method=body?'POST':'GET',expected=200){
 const headers={'Content-Type':'application/json',Origin:origin,'User-Agent':'Mozilla/5.0 Safari/605.1 Version/17.0'};if(cookie)headers.Cookie=cookie;if(csrf)headers['X-CSRF-Token']=csrf;
 const response=await fetch(origin+path,{method,headers,body:body?JSON.stringify(body):undefined});
 assert.equal(response.status,expected,`${method} ${path}: ${response.status}`);
 return response;
}
const password=randomBytes(24).toString('hex');
async function login(){cookie=undefined;csrf=undefined;const r=await request('/api/auth/login',{email:'owner@example.com',password});cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf;}
const day=new Date().toISOString().slice(0,10);
let site,org;
async function reports(){
 const query=`from=${day}&to=${day}`;
 const urls=[`/api/report?site=${site.id}&${query}`,`/api/organisations/${org.id}/report?${query}&section=summary`,`/api/insights?org=${org.id}&${query}&section=summary`,`/api/export?site=${site.id}&${query}&dataset=totals`];
 const result=[];for(const url of urls)result.push(await(await request(url)).text());return result;
}
const event=(type,page)=>request('/api/event',{site:site.id,type,url:'https://proof.example/thanks',page,...(type==='event'?{name:'purchase',revenue:12.5}:{}),...(type==='activity'?{visible:30000}:{})},'POST',202);
try{
 const persist=resolve(dir,'.wrangler/state');await start(persist);
 await request('/api/sites',undefined,'GET',401);
 const secret=readFileSync(resolve(dir,'.dev.vars'),'utf8').trim().split('=')[1];
 await request('/api/auth/setup',{secret,email:'owner@example.com',password});await login();
 org=await(await request('/api/organisations',{name:'Local proof'} ,'POST',201)).json();
 site=await(await request('/api/sites',{name:'Proof',domain:'proof.example',kind:'store',organisationId:org.id},'POST',201)).json();
 await request(`/api/sites/${site.id}`,{aliases:['www.proof.example'],excludedPaths:['/private']},'PATCH');
 assert.match(await(await request('/script.js')).text(),/postdeploy/);
 const page=randomBytes(16).toString('hex');await event('pageview',page);await event('event',page);await event('activity',page);
 const before=await reports();await stop();
 const collected=new DatabaseSync(dbFile(persist),{readOnly:true}); assert.equal(collected.prepare("SELECT count(*) AS n FROM events WHERE type='pageview'").get().n,1); assert.ok(collected.prepare("SELECT count(*) AS n FROM events WHERE type='event'").get().n>=1); collected.close();
 const source=dbFile(persist), backup=resolve(evidence,'legacy.sqlite');
 await protectedCopy(source,backup);
 execute(['d1','export','DB','--local','--output',resolve(evidence,'wrangler-export.sql')]);
 // The existing exact exporter retains arbitrary identity types and migration history.
 execFileSync(process.execPath,['worker/scripts/compact-export.mjs',backup,resolve(evidence,'parts'),'--parts']);
 const restored=resolve(dir,'restored');
 for(const file of JSON.parse(readFileSync(resolve(evidence,'parts/manifest.json'))).files)execute(['d1','execute','DB','--local','--persist-to',restored,'--file',resolve(evidence,'parts',file)]);
 compare(backup,dbFile(restored));
 await start(restored);await login();assert.deepEqual(await reports(),before);await event('pageview',randomBytes(16).toString('hex'));await stop();
 const current=dbFile(restored);
 for(const command of ['prepare','copy','verify','activate'])execFileSync(process.execPath,['worker/scripts/compact-storage.mjs',command,current,...(command==='prepare'?[resolve(evidence,'pre-compact.sqlite')]:[])]);
 await start(restored);await login();await reports();await event('pageview',randomBytes(16).toString('hex'));await stop();
 await protectedCopy(current,resolve(evidence,'compact.sqlite'));
 for(const command of ['prepare','resume','verify'])execFileSync(process.execPath,['worker/scripts/storage-headroom.mjs',command,current,resolve(evidence,'headroom.sqlite')]);
 execFileSync(process.execPath,['worker/scripts/compact-storage.mjs','retire',current,resolve(evidence,'pre-retire.sqlite')]);
 execFileSync(process.execPath,['worker/scripts/compact-export.mjs',current,resolve(evidence,'compact-parts'),'--parts']);
 const compactRestore=resolve(dir,'compact-restored');
 for(const file of JSON.parse(readFileSync(resolve(evidence,'compact-parts/manifest.json'))).files)execute(['d1','execute','DB','--local','--persist-to',compactRestore,'--file',resolve(evidence,'compact-parts',file)]);
 compare(current,dbFile(compactRestore));
 await start(compactRestore);await login();await reports();await event('pageview',randomBytes(16).toString('hex'));await stop();
 // Rollback proof uses the independent pre-retirement copy, preserving the retired source.
  const rollbackFile=resolve(evidence,'rollback.sqlite');
 await protectedCopy(resolve(evidence,'compact.sqlite'),rollbackFile);

 execFileSync(process.execPath,['worker/scripts/compact-storage.mjs','rollback',rollbackFile]);
 const db=new DatabaseSync(rollbackFile,{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM events WHERE type=\'pageview\'').get().n,3);db.close();
 await start(compactRestore);await login();await reports();await event('pageview',randomBytes(16).toString('hex'));await stop();
 writeFileSync(resolve(evidence,'result.json'),JSON.stringify({name,status:'passed',checks:['empty local migrations','secure setup/login','organisation/project/domains','tracker/page/named/activity','report/section/CSV','protected backup','local D1 isolated SQL import','exact schema/rows/reports','post-restore write','populated compact upgrade','post-activation write','rollback retains newer writes','headroom upgrade','retired compact isolated D1 import','write after retired restore']},null,2),{mode:0o600});
 console.log(`Local installation proof passed: ${evidence}/result.json`);
} finally {await stop();writeFileSync(resolve(evidence,'wrangler.log'),serverLog,{mode:0o600});}
