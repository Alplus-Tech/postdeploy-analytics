import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { verifyHistory } from './history-assertions.mjs';
import {sectionStream} from '../src/section-stream.ts';
import {readSection} from '../../frontend/section-loader.ts';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { parseReportQuery } from '../src/report.ts';
import { buildInsights } from '../src/insights.ts';
import { organisationReport } from '../src/organisations.ts';

const [file, scope = 'org', section = 'summary'] = process.argv.slice(2);
if (!file || !['org','project','overview'].includes(scope)) throw Error('Usage: acceptance-history.mjs DB org|project|overview SECTION');
const before=statSync(file);
if(!(scope==='overview'?['summary','series','goals','measurement','complete']:['summary','timeline','composition','ranking','heatmap','duration','complete']).includes(section)) throw Error('Unknown section');
const child = spawn('python3', [new URL('./readonly-query.py', import.meta.url).pathname, resolve(file)], {stdio:['pipe','pipe','inherit']});
const lines = createInterface({input:child.stdout})[Symbol.asyncIterator]();
let count = 0;
const sql = {run:async()=>{throw Error('Read only');}, all:async(query,params=[])=>{
 child.stdin.write(JSON.stringify({query,params})+'\n');
 const next = await lines.next(); if(next.done) throw Error('Read worker exited');
 const result = JSON.parse(next.value);
 console.log(JSON.stringify({statement:++count,ms:result.ms,error:result.error,plan:result.ms>1000?result.plan:undefined}));
 if(result.error) throw Error(result.error);
 return result.rows;
}};
const deadline = setTimeout(()=>child.kill('SIGKILL'),600000);
try {
 const params=new URLSearchParams('site=p0&from=2024-11-01&to=2026-10-31');
 const query=parseReportQuery(params), start=performance.now();
 const build=async readSql=>scope==='overview'?await organisationReport(readSql,'default',query,section==='complete'?undefined:section):await buildInsights(readSql,query,params,Date.parse('2026-11-01T12:00:00Z'),scope==='org'?'default':undefined,section==='complete'?undefined:section);
 let result;
 if(process.argv.includes('--stream')) {
   let last=performance.now(),maxGap=0,frames=0;
   result=await readSection(sectionStream(sql,new AbortController().signal,async readSql=>Response.json(await build(readSql))),()=>{
     const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;frames++;
   });
   console.log(JSON.stringify({mode:'offline stream with actual full corpus',frames,maxGap}));
 } else result=await build(sql);
 assert.equal(statSync(file).size,before.size);assert.equal(statSync(file).mtimeMs,before.mtimeMs);
 console.log(JSON.stringify({assertions:await verifyHistory(result,query,scope,section)}));
 console.log(JSON.stringify({scope,section,ms:performance.now()-start,status:'complete',result}));
} catch(error) {console.log(JSON.stringify({scope,section,status:'failed',error:String(error)}));process.exitCode=1;}
finally {clearTimeout(deadline);child.stdin.end();}
