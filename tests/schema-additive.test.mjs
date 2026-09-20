import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migrationFiles = [
  new URL("../drizzle/0000_flawless_jack_murdock.sql", import.meta.url),
  new URL("../drizzle/0001_dizzy_spiral.sql", import.meta.url),
];

async function readStatements(url) {
  const sql = await readFile(url, "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

test("the normalized migration is schema-only and leaves legacy workspaces untouched", async () => {
  const normalizedSql = await readFile(migrationFiles[1], "utf8");
  assert.doesNotMatch(normalizedSql, /^\s*(?:INSERT|UPDATE|DELETE)\b/im);
  assert.doesNotMatch(normalizedSql, /\bDROP\b/i);
  assert.doesNotMatch(normalizedSql, /ALTER\s+TABLE\s+[`\"]?workspaces\b/i);
  assert.doesNotMatch(normalizedSql, /CREATE\s+TABLE\s+[`\"]?workspaces\b/i);

  const database = new DatabaseSync(":memory:");
  for (const statement of await readStatements(migrationFiles[0])) database.exec(statement);
  database.prepare(
    "INSERT INTO workspaces (owner, state, revision, updated_at) VALUES (?, ?, ?, ?)",
  ).run("legacy-owner", '{"recipes":[]}', 291, "2026-09-20T12:15:16.193Z");

  for (const statement of await readStatements(migrationFiles[1])) database.exec(statement);

  const legacy = database.prepare("SELECT owner, state, revision, updated_at FROM workspaces").get();
  assert.deepEqual({ ...legacy }, {
    owner: "legacy-owner",
    state: '{"recipes":[]}',
    revision: 291,
    updated_at: "2026-09-20T12:15:16.193Z",
  });
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
  ).all().map((row) => row.name);
  assert.ok(tables.includes("business_workspaces"));
  assert.ok(tables.includes("recipes_v2"));
  assert.ok(tables.includes("products"));
  assert.ok(tables.includes("migration_sources"));
  assert.ok(tables.includes("workspaces"));
});
