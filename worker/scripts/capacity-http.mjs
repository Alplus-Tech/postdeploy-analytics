import { performance } from 'node:perf_hooks';

// Run against an isolated local installation populated by capacity-fixture.mjs.
const [root = 'http://127.0.0.1:8787'] = process.argv.slice(2);
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(root).hostname)) throw Error('Local fixture only');
const token = process.env.CAPACITY_SESSION;
if (!token) throw Error('Set CAPACITY_SESSION to a disposable fixture session');
for (const scope of ['site=p0','org=default']) {
  for (const [name,range] of [
    ['short','from=2026-10-01&to=2026-10-01'],
    ['month','from=2026-10-01&to=2026-10-30'],
    ['long','from=2024-11-01&to=2026-10-30'],
    ['comparison','from=2026-10-01&to=2026-10-30&cmpFrom=2026-09-01&cmpTo=2026-09-30'],
    ['selective','from=2026-10-01&to=2026-10-30&f=source:Source%201'],
  ]) for (const kind of ['insights','report','csv']) {
    const path = kind === 'report' ? (scope.startsWith('org') ? '/api/organisations/default/report?' : '/api/report?') : '/api/insights?';
    const start = performance.now();
    try {
      const response = await fetch(root+path+scope+'&'+range+(kind==='csv'?'&dataset=timeline':''), {headers:{Cookie:'pd_session='+token},signal:AbortSignal.timeout(60000)});
      const bytes = (await response.arrayBuffer()).byteLength;
      console.log(JSON.stringify({scope,name,kind,status:response.status,ms:performance.now()-start,bytes}));
    } catch (error) { console.log(JSON.stringify({scope,name,kind,ms:performance.now()-start,error:String(error)})); }
  }
}
