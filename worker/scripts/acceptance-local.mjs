import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, statfsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { prepare, activate } from './compact-storage.mjs';
import { hashSync } from 'bcryptjs';
import { runRetention } from '../src/retention.ts';

const dir=resolve(process.argv[2]??'.scratch/local-acceptance/run-'+Date.now());
if(!dir.startsWith(resolve('.scratch')+'/'))throw Error('Evidence must be beneath .scratch');
const reserve=()=>{const s=statfsSync(dir);assert.ok(s.bavail*s.bsize>10*1024**3+100*1024**2,'10 GiB reserve plus 100 MiB fixture budget required');};
mkdirSync(dir,{mode:0o700});reserve();
const port=8798, origin=`http://127.0.0.1:${port}`, persist=resolve(dir,'state');
const config=resolve(dir,'wrangler.json');
writeFileSync(config,JSON.stringify({name:'postdeploy-acceptance',main:resolve('worker/src/index.ts'),compatibility_date:'2026-11-01',assets:{directory:resolve('demo'),binding:'ASSETS',run_worker_first:['/api/*','/script.js']},d1_databases:[{binding:'DB',database_name:'acceptance',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:resolve('migrations')}],vars:{ENVIRONMENT:'production',APP_ORIGIN:'https://analytics.example.com'}}));
const wrangler=resolve('node_modules/.bin/wrangler');
execFileSync(wrangler,['d1','migrations','apply','DB','--local','--config',config,'--persist-to',persist],{stdio:'pipe',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const dbdir=resolve(persist,'v3/d1/miniflare-D1DatabaseObject');
const file=resolve(dbdir,readdirSync(dbdir).find(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite'));
let db=new DatabaseSync(file);if(process.env.ACCEPTANCE_LAYOUT!=='legacy'){prepare(db);activate(db);}
const hash=s=>createHash('sha256').update(s).digest('hex');
const identities={};
for(const role of ['admin','viewer']){const token=randomBytes(32).toString('hex');identities[role]={Cookie:'pd_session='+token,'X-CSRF-Token':hash('csrf:'+token)};db.prepare('INSERT INTO auth_users(id,email,role,created_at,password_hash) VALUES(?,?,?,?,?)').run(role,role+'@example.com',role,Date.now(),hashSync(randomBytes(24).toString('hex'),4));db.prepare('INSERT INTO auth_sessions VALUES(?,?,0,?)').run(hash(token),role,Date.now()+86400000);}
db.close();
let server;
const samples=[],checks=[];
async function start(){server=spawn(wrangler,['dev','--local','--config',config,'--persist-to',persist,'--ip','127.0.0.1','--port',String(port)],{detached:true,stdio:['ignore','ignore','ignore'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});for(let i=0;i<150;i++){try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Worker startup failed');}
async function stop(){if(server){const s=server;server=undefined;process.kill(-s.pid,'SIGTERM');await new Promise(r=>s.once('exit',r));}}
async function request(path,body,role='admin',expected=200,extra={}){
 const start=performance.now();const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://analytics.example.com','User-Agent':'Mozilla/5.0 Safari/605.1',...(identities[role]??{}),...extra},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 samples.push({kind:path.startsWith('/api/event')?'collection':'read/admin',status:r.status,ms:performance.now()-start});assert.equal(r.status,expected,`${path}: ${await r.clone().text()}`);return r;
}
const day=new Date().toISOString().slice(0,10), range=`from=${day}&to=${day}`;
const stats=()=>{const d=new DatabaseSync(file,{readOnly:true});const out={bytes:statSync(file).size,freelist:d.prepare('PRAGMA freelist_count').get(),pageSize:d.prepare('PRAGMA page_size').get(),events:d.prepare('SELECT count(*) n FROM events').get().n,visits:d.prepare('SELECT count(*) n FROM visits').get().n,visibleMs:d.prepare('SELECT sum(visible_ms) n FROM visits').get().n,identities:d.prepare('SELECT length(visitor_id) n,length(session_id) s FROM events LIMIT 1').get()};try{out.indexes=d.prepare("SELECT name,sum(pgsize) bytes FROM dbstat WHERE name LIKE 'compact_%' GROUP BY name").all();}catch{out.indexes='dbstat unavailable';}d.close();return out;};
const projects=[],cohorts=[];let baseline,final;
try{
 await start();await request('/api/sites/catalog',undefined,'none',401);
 await request('/api/organisations',{name:'No CSRF'},'admin',403,{'X-CSRF-Token':''});
 await request('/api/organisations',{name:'Viewer denied'},'viewer',403);
 const org=await(await request('/api/organisations',{name:'Acceptance'},'admin',201)).json();
 const other=await(await request('/api/organisations',{name:'Isolated'},'admin',201)).json();
 for(let i=0;i<3;i++)projects.push(await(await request('/api/sites',{name:'Project '+i,domain:`p${i}.example`,kind:'store',organisationId:i===2?other.id:org.id},'admin',201)).json());
 checks.push('anonymous denies','Admin CSRF denies','Viewer mutation denies');
 const send=(site,page,type='pageview',extra={},headers={})=>request('/api/event',{site:site.id,type,url:`https://${site.domain}/`+(page.startsWith('a')?'common':('long/'+page+'/'.repeat(1)+'x'.repeat(300)))+'?utm_source='+page+'&utm_campaign=campaign-'+page,page,...(type==='event'?{name:'purchase'}:{}),...(type==='activity'?{visible:100}:{}),...extra},'none',headers.Origin==='https://unlisted.example'?403:202,{Origin:`https://${site.domain}`,...headers});
 await send(projects[0],randomBytes(16).toString('hex'),'pageview',{}, {Origin:'https://unlisted.example'});
 checks.push('production domain rejection');
 await stop();baseline=stats();assert.equal(baseline.events,0);await start();
 for(let cycle=0;cycle<3;cycle++){
  const pages=Array.from({length:12},(_,i)=>({site:projects[i<9?0:i<11?1:2],page:randomBytes(16).toString('hex'),ip:`198.51.${cycle}.${i+1}`,pulse:cycle===0&&i===0}));
  const reads=(async()=>{for(const section of ['summary','timeline','composition','ranking','heatmap','duration'])await request(`/api/insights?org=${org.id}&${range}&section=${section}`,undefined,'viewer');await request(`/api/insights?org=${org.id}&${range}&dataset=timeline`,undefined,'viewer');})();
  for(let i=0;i<pages.length;i+=3){await Promise.all(pages.slice(i,i+3).map(async({site,page,ip,pulse})=>{const h={'CF-Connecting-IP':ip};await send(site,page,'pageview',{},h);await send(site,page,'pageview',{},h);await send(site,page,'event',{},h);await new Promise(r=>setTimeout(r,pulse?30100:150));await send(site,page,'activity',pulse?{visible:30000}:{},h);await send(site,page,'activity',pulse?{visible:30000}:{},h);}));await new Promise(r=>setTimeout(r,100));}
  await reads;await stop();
  const peak=stats();
  const d=new DatabaseSync(file);const sql={all:async(q,p=[])=>d.prepare(q).all(...p),run:async(q,p=[])=>{d.prepare(q).run(...p);}};
  // Advance maintenance eligibility without removing retained history or live fixture credentials.
  const saved=d.prepare('SELECT count(*) n FROM auth_sessions').get().n;
  const cleanup=await runRetention(sql,Date.now()+3600000,5000);
  assert.equal(cleanup.deleted,0);assert.equal(cleanup.visitsDeleted,0);
  assert.equal(d.prepare("SELECT count(*) n FROM events WHERE type='pageview'").get().n,(cycle+1)*12);
  assert.equal(d.prepare("SELECT count(*) n FROM events WHERE type='event'").get().n,(cycle+1)*12);
  assert.equal(d.prepare('SELECT sum(visible_ms) n FROM visits').get().n,(cycle+1)*12*100+29900);
  assert.equal(d.prepare('SELECT count(*) n FROM visits').get().n,(cycle+1)*12);
  assert.equal(d.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(d.prepare('SELECT count(*) n FROM auth_sessions').get().n,saved);
  d.close();reserve();cohorts.push({cycle,cleanup,beforeCleanup:peak,physical:stats()});await start();
 }
 const streaming=await request(`/api/insights?org=${org.id}&${range}&section=summary`,undefined,'viewer',200,{Accept:'application/x-ndjson'});
 const frames=(await streaming.text()).trim().split('\n').map(JSON.parse);
 assert.equal(frames.at(-1).state,'complete');
 assert.deepEqual(frames.at(-1).value,await(await request(`/api/insights?org=${org.id}&${range}&section=summary`,undefined,'viewer')).json());
 const data=await(await request(`/api/organisations/${org.id}/report?${range}&section=summary`,undefined,'viewer')).json();
 assert.equal(data.main.totals.pageviews,33);
 const isolated=await(await request(`/api/organisations/${other.id}/report?${range}&section=summary`,undefined,'viewer')).json();assert.equal(isolated.main.totals.pageviews,3);
 await request(`/api/insights?org=${org.id}&${range}&section=unknown`,undefined,'viewer',400);
 await request(`/api/insights?org=${org.id}&from=2020-01-01&to=${day}`,undefined,'viewer',400);
 await request(`/api/organisations/${org.id}/export?${range}&dataset=totals`,undefined,'viewer');
 checks.push('skewed organisation isolation','731-day validation','unknown section error','Viewer CSV','replay deduplication','exact named/page/activity persistence','three expiry/cleanup cycles preserve history');
 await stop();final=stats();
 const percentiles=values=>{values.sort((a,b)=>a-b);return {n:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)};};
 const result={status:'passed',layout:process.env.ACCEPTANCE_LAYOUT??'compact',checks,baseline,final,cohorts,requests: samples,latency:{collection:percentiles(samples.filter(s=>s.kind==='collection').map(s=>s.ms)),other:percentiles(samples.filter(s=>s.kind!=='collection').map(s=>s.ms))},limits:'36 finite visitors; 180 legitimate collection requests plus one rejected-domain probe. No steady-state or deployed capacity claim. Sessions seeded offline; use test:install for real setup/login/restore.'};
 writeFileSync(resolve(dir,'result.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({status:result.status,evidence:resolve(dir,'result.json'),latency:result.latency,final}));
}finally{await stop();}
