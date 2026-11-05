import test from 'node:test';
import assert from 'node:assert/strict';
import { memorySql, addSite } from './sqlite.mjs';
import { selectedSessions } from '../src/session-selection.ts';
import { organisationScope } from '../src/organisations.ts';
import { eventScope } from '../src/report.ts';

test('session selection preserves filtered report populations without expanding synthetic goal rows', async () => {
  const { sql, db } = memorySql();
  await addSite(sql, 'a', 'a.example', 'store');
  await addSite(sql, 'b', 'b.example', 'store');
  for (const site of ['a', 'b']) {
    for (let i = 0; i < 3; i++) {
      await sql.run("INSERT INTO events(site_id,at,day,hour,type,path,entry_path,source,country,device,browser,visitor_id,session_id) VALUES(?,1790812800000,'2026-10-01',0,'pageview',?,'/','Direct','US','Desktop','Chrome',?,?)", [site, i === 0 ? '/goal' : '/', 'v'+i, site+i]);
    }
  }
  await sql.run("INSERT INTO page_goal_matches SELECT id,'signup' FROM events WHERE path='/goal'");
  await sql.run("INSERT INTO visits(session_id,site_id,visitor_id,day,hour,timezone,at,last_at,path,entry_path,source,country,device,browser) VALUES('orphan','a','continued','2026-10-01',0,'UTC',1790812800000,1790812800000,'/continued','/','Direct','US','Desktop','Chrome')");
  const range = { from:'2026-10-01', to:'2026-10-01' };
  for (const filters of [[], [{dim:'source',value:'Direct'}], [{dim:'page',value:'/goal'}], [{dim:'page',value:'/absent'}], [{dim:'entry',value:'/'}], [{dim:'country',value:'US'}], [{dim:'device',value:'Desktop'}], [{dim:'browser',value:'Chrome'}], [{dim:'referrer',value:'Direct or unknown'}], [{dim:'campaign',value:'missing'}], [{dim:'page',value:'/goal'},{dim:'country',value:'US'}], Array.from({length:8},()=>({dim:'page',value:'/goal'}))]) {
    for (const scope of [eventScope('a',range,filters), organisationScope('default',range,filters)]) {
      const where = scope.where ?? scope.sql;
      const q = selectedSessions(where,scope.params);
      assert.ok(q.params.length + 2 <= 100);
      const expected = await sql.all(`SELECT DISTINCT site_id,session_id FROM report_events e WHERE ${where} ORDER BY site_id,session_id`, scope.params);
      assert.deepEqual(await sql.all(`${q.sql} ORDER BY site_id,session_id`,q.params),expected);
      const plan = db.prepare('EXPLAIN QUERY PLAN '+q.sql).all(...q.params);
      assert.ok(!plan.some(r=>r.detail.includes('CO-ROUTINE report_events')));
    }
  }
  db.close();
});
