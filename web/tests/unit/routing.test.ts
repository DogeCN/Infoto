import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isAdminRoute } from '../../src/routing';

test('mounts Admin only for the exact /admin route', () => {
  assert.equal(isAdminRoute('/admin'), true);
  assert.equal(isAdminRoute('/admin/'), false);
  assert.equal(isAdminRoute('/admin/settings'), false);
  assert.equal(isAdminRoute('/administer'), false);
});
