// Guards the three places the schema is spelled out: schema.sql, the generated
// schema-ddl.ts, and the migrate route's export column lists.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema-ddl.ts';
import { EXPORT_COLUMNS, MIGRATE_TABLES } from './routes/migrate.ts';

const file = readFileSync(path.join(import.meta.dirname, '..', '..', 'schema.sql'), 'utf8');

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Table name -> declared column names, read out of the CREATE TABLE statements. */
function schemaColumns(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
  for (const m of sql.matchAll(re)) {
    const name = m[1]!;
    const body = m[2]!;
    const columns: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of body) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        columns.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    columns.push(current);
    out.set(
      name.toLowerCase(),
      columns
        .map((c) => c.trim().split(/\s+/)[0]!)
        .filter((c) => c && !/^(?:primary|foreign|unique|check|constraint)$/i.test(c))
        .map((c) => c.toLowerCase()),
    );
  }
  return out;
}

test('schema-ddl.ts matches schema.sql after whitespace/case normalize', () => {
  assert.equal(norm(SCHEMA_SQL), norm(file));
});

test('the export column lists cover every declared column, in order', () => {
  const declared = schemaColumns(file);
  for (const [table, columns] of Object.entries(EXPORT_COLUMNS)) {
    assert.deepEqual([...columns], declared.get(table), table);
  }
  assert.deepEqual(
    [...MIGRATE_TABLES].sort(),
    [...declared.keys()].sort(),
    'every table in schema.sql is exported',
  );
});
