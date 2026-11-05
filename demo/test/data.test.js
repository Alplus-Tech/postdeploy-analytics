const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/data.js");

const today = Date.UTC(2026, 10, 4);
const opts = (extra) => Object.assign({ range: "30d", compare: "prev", todayMs: today, nowHour: 14, filters: [] }, extra);
const sum = (rows, key) => rows.reduce((a, r) => a + r[key], 0);
const close = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9), `${a} != ${b}`);

for (const site of D.defaultSites()) {
  test(`${site.name}: breakdowns add up to the totals they explain`, () => {
    const r = D.query(site, opts({ filters: [{ dim: "device", value: "Mobile" }] }));
    for (const dim of ["source", "country", "device", "browser", "entry"]) {
      const rows = D.breakdown(site, r.main, dim, [{ dim: "device", value: "Mobile" }]);
      close(sum(rows, "visitors"), r.main.totals.visitors);
      close(sum(rows, "conversions"), r.main.totals.conversions);
    }
    close(sum(r.main.buckets, "visitors"), r.main.totals.visitors);
    close(sum(r.main.buckets, "revenue"), r.main.totals.revenue);
  });

  test(`${site.name}: payments by channel add up to the paying goal`, () => {
    const r = D.query(site, opts()).main;
    close(sum(D.breakdown(site, r, "source", []), "purchases"), r.totals.goals[r.purchase]);
  });

  test(`${site.name}: a filter narrows every figure, never grows it`, () => {
    const all = D.query(site, opts()).main.totals;
    const google = D.query(site, opts({ filters: [{ dim: "source", value: "Google" }] })).main.totals;
    assert.ok(google.visitors > 0 && google.visitors < all.visitors);
    assert.ok(google.revenue <= all.revenue);
  });

  test(`${site.name}: the funnel narrows and ends at the paying goal`, () => {
    const r = D.query(site, opts({ range: "90d" })).main;
    const steps = D.funnel(r).steps;
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i].count <= steps[i - 1].count);
    close(steps[steps.length - 1].count, r.totals.goals[r.purchase]);
  });
}

test("the same day reads the same numbers on every visit", () => {
  const site = D.defaultSites()[0];
  assert.equal(D.query(site, opts()).main.totals.visitors, D.query(site, opts()).main.totals.visitors);
});

test("a new website has no data until it reports a visit", () => {
  const site = D.makeSite({ id: "new", name: "New", domain: "new.example", kind: "store", base: 100, growth: 0, ppv: 2, bounce: 0.5, duration: 60, aov: 10, currency: "€", created: "2026-11-04", empty: true });
  assert.equal(D.query(site, opts()).main.totals.visitors, 0);
});

test("a new website reports exactly the sample pageviews it has received", () => {
  const site = D.makeSite({ id: "fresh", name: "Fresh", domain: "fresh.example", kind: "saas", base: 90, growth: 0, ppv: 3, bounce: 0.4, duration: 60, aov: 10, currency: "€", created: "2026-11-04", visits: [] });
  assert.equal(D.query(site, opts()).main.totals.visitors, 0);
  site.visits.push({ at: today + 14 * 3600000 + 60000, page: "/" });
  let t = D.query(site, opts({ range: "today" })).main;
  assert.equal(t.totals.visitors, 1);
  assert.equal(t.totals.pageviews, 1);
  assert.equal(t.totals.conversions, 0);
  site.visits.push({ at: today + 14 * 3600000 + 120000, page: "/pricing" });
  t = D.query(site, opts()).main;
  assert.equal(t.totals.visitors, 2);
  assert.equal(sum(D.breakdown(site, t, "page", []), "pageviews"), 2);
  assert.ok(D.funnel(t).steps.every((s) => s.count === 0));
});
