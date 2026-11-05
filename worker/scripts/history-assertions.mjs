import assert from 'node:assert/strict';
import { insightsCsv } from '../src/insights.ts';
import { organisationCsv } from '../src/exports.ts';

const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);

// This oracle describes only the documented synthetic two-year corpus.
export async function verifyHistory(result, query, scope, section) {
  const main = result.main, population = scope === 'project' ? 480000 : 24000000;
  const exports = [];
  if (scope !== 'overview') {
    if (section === 'summary' || section === 'complete') {
      assert.equal(main.totals.pageviews,population);
      assert.equal(main.totals.visitorDays,population);
    }
    for (const dataset of ['timeline','composition','ranking','heatmap','duration']) {
      if (section !== dataset && section !== 'complete') continue;
      const rows = main[dataset];
      assert.equal(sum(rows,dataset === 'duration' ? 'visits' : 'pageviews'),population);
      if (dataset === 'timeline' || dataset === 'ranking') {
        assert.equal(sum(rows,'visitorDays'),population);
        assert.equal(sum(rows,'conversionVisitorDays'),population);
        assert.equal(sum(rows,'completions'),scope === 'project' ? 480000 : 3600000);
        assert.equal(sum(rows,'convertedVisitorDays'),scope === 'project' ? 480000 : 3480000);
        for (const row of rows) assert.equal(row.rate,row.conversionVisitorDays ? row.convertedVisitorDays/row.conversionVisitorDays : 0);
      }
      if (dataset === 'duration' && scope !== 'project') assert.deepEqual(rows.map(r=>r.visits),[0,6000000,0,6000000,6000000,6000000,0]);
      exports.push(await verifyCsv(await insightsCsv(result,query,dataset).text(),rows,dataset));
    }
  } else {
    if (section === 'measurement') assert.equal(main.measurement.visits,population);
    if (section === 'series') {
      assert.equal(sum(main.buckets,'pageviews'),population);
      assert.equal(sum(main.buckets,'visitorDays'),population);
      exports.push(await verifyCsv(await organisationCsv(result,query,'series').text(),main.buckets,'series'));
    }
    if (section === 'goals') {
      assert.equal(main.conversions.completions,3600000);
      assert.equal(main.conversions.convertedVisitorDays,3480000);
      assert.equal(main.conversions.visitorDays,population);
      assert.equal(main.conversions.rate,3480000/population);
      for (const row of main.goals) {
        const project = /^p(\d+)$/.exec(row.projectId);
        const expected = project && row.goalId === 'purchase' && Number(project[1])%10 === 0 ? 480000 : 0;
        assert.equal(row.completions,expected);
        assert.equal(row.convertedVisitorDays,expected);
        assert.equal(row.visitorDays,project ? 480000 : 0);
        assert.equal(row.rate,row.visitorDays ? expected/row.visitorDays : 0);
      }
      exports.push(await verifyCsv(await organisationCsv(result,query,'goals').text(),main.goals,'goals'));
    }
  }
  return {population,exports};
}

async function verifyCsv(csv, rows, dataset) {
  const records = csv.replace(/^\uFEFF/,'').trimEnd().split('\r\n').map(line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>m[1].replaceAll('""','"')));
  const columns = records.shift();
  assert.equal(records.length,rows.length);
  for (let i=0;i<rows.length;i++) {
    assert.equal(records[i].length,columns.length);
    const record = Object.fromEntries(columns.map((key,j)=>[key,records[i][j]]));
    assert.equal(record.period,'selected');
    for (const [key,value] of Object.entries(rows[i])) {
      assert.ok(columns.includes(key),`${dataset} column ${key}`);
      assert.equal(record[key],String(value),`${dataset} row ${i} ${key}`);
    }
  }
  return {dataset,rows:rows.length,bytes:Buffer.byteLength(csv),cells:'exact table values'};
}
