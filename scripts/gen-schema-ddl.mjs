import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sql = readFileSync(path.join(root, 'schema.sql'), 'utf8');
const creates = [...sql.matchAll(/CREATE TABLE[\s\S]*?;/gi)].map((m) => m[0].trim());
const out = `// Generated from schema.sql — run \`npm run gen-schema\`. Do not edit by hand.
export const SCHEMA_SQL = ${JSON.stringify(sql)};
export const CREATE_TABLE_SQL: readonly string[] = ${JSON.stringify(creates)};
`;
writeFileSync(path.join(root, 'src/worker/schema-ddl.ts'), out);
console.log(`wrote src/worker/schema-ddl.ts (${creates.length} CREATE TABLE)`);
