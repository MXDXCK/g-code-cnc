// Свои чертежи владельца не должны попасть в git: в tests/fixtures/private отслеживается только README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('в git нет файлов из tests/fixtures/private, кроме README.md', t => {
  let out;
  try { out = execFileSync('git', ['ls-files', '--', 'tests/fixtures/private'], { encoding: 'utf8' }); } catch (e) { t.skip('git недоступен'); return; }
  assert.deepEqual(out.split('\n').filter(f => f && f !== 'tests/fixtures/private/README.md'), []);
});
