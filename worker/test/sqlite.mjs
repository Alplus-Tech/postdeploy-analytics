import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { prepare, activate } from "../scripts/compact-storage.mjs";
import { INSERT_SITE, siteRowValues } from "../src/sites.ts";

const dir = new URL("../../migrations/", import.meta.url);
const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, dir), "utf8"));

export function memorySql() {
  const db = new DatabaseSync(":memory:");
  for (const m of migrations) db.exec(m);
  if (process.env.COMPACT_STORAGE === "1") { prepare(db); activate(db); }
  return {
    db,
    sql: {
      async all(query, params = []) {
        return db.prepare(query).all(...params);
      },
      async run(query, params = []) {
        db.prepare(query).run(...params);
      },
    },
  };
}

export async function addSite(sql, id, domain, kind, timezone = "UTC") {
  await sql.run(INSERT_SITE, siteRowValues({ id, name: id, domain, kind, currency: "$", timezone, created: "2026-01-01" }));
}
