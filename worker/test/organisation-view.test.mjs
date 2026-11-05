import test from 'node:test';
import assert from 'node:assert/strict';
import { readSelection, pageAddress, reportQuery, presetFor, projectReportAddress, exportAddress } from '../../frontend/organisation-view.ts';

const now = Date.parse('2026-11-05T12:00:00Z');
const live = '?from=2026-10-07&to=2026-11-05&cmpFrom=2026-09-07&cmpTo=2026-10-06&org=default&compare=prev';

test('organisation addresses keep the existing URL and comparison contract', () => {
  const sel = readSelection(live, now, 'other');
  assert.equal(pageAddress(sel), '/organisations' + live);
  assert.equal(presetFor(sel, now), '30d');
  const filtered = readSelection('?org=a&from=2026-01-01&to=2026-01-10&f=page:/a:b&compare=off', now, 'x');
  assert.deepEqual(filtered.filter, { dim: 'page', value: '/a:b' });
  assert.equal(reportQuery(filtered).toString(), 'from=2026-01-01&to=2026-01-10&f=page%3A%2Fa%3Ab');
  assert.equal(presetFor(filtered, now), 'custom');
  assert.equal(readSelection('?f=bogus:x', now, 'x').filter, null);
  assert.equal(exportAddress(sel, 'goals'), '/api/organisations/default/export?from=2026-10-07&to=2026-11-05&cmpFrom=2026-09-07&cmpTo=2026-10-06&dataset=goals');
});

test('project drilldowns open the project report on the private dashboard', () => {
  const sel = readSelection(live, now, 'x');
  assert.equal(projectReportAddress('p1', sel), '/dashboard#/overview?site=p1&range=custom&from=2026-10-07&to=2026-11-05&cmp=prev');
});
