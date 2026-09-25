// 清空本地 D1（wrangler dev 的本地 sqlite state）并重建 schema。
// 用法：node scripts/reset-local-db.mjs
// 只动 .wrangler/state/v3/d1 —— 线上 D1 不受影响。

import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const targets = [
	path.join(root, '.wrangler/state/v3/d1'),
	path.join(root, '.wrangler/state/v3/cache'),
];

for (const t of targets) {
	if (existsSync(t)) {
		await rm(t, { recursive: true, force: true });
		console.log('removed', path.relative(root, t));
	}
}

const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'infoto-dev', '--local', '--file=schema.sql'], {
	cwd: root,
	stdio: 'inherit',
	shell: process.platform === 'win32',
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('local D1 reset + schema applied');
