import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema-ddl.ts';

const file = readFileSync(path.join(import.meta.dirname, '..', '..', 'schema.sql'), 'utf8');

function norm(s: string): string {
	return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

test('schema-ddl.ts matches schema.sql after whitespace/case normalize', () => {
	assert.equal(norm(SCHEMA_SQL), norm(file));
});
