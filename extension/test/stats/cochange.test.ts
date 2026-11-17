import test from 'node:test';
import assert from 'node:assert';
import { parseGitLog, coChange } from '../../src/stats/cochange';

test('cochange_probabilities', () => {
  const m = coChange([['a', 'b'], ['a', 'b'], ['a', 'c']], 'a');
  assert.ok(Math.abs((m.get('b') ?? 0) - 0.667) < 0.01);
  assert.ok(Math.abs((m.get('c') ?? 0) - 0.333) < 0.01);
});

test('parseGitLog_skips_mass_commits', () => {
  // Commit 1: 31 files
  const hash1 = 'a'.repeat(40);
  const files31 = Array.from({ length: 31 }, (_, i) => `file_${i}.py`).join('\n');

  // Commit 2: 2 files
  const hash2 = 'b'.repeat(40);
  const files2 = 'app.py\ntest_app.py';

  const raw = `${hash1}\n${files31}\n${hash2}\n${files2}\n`;
  const parsed = parseGitLog(raw, 30);
  assert.strictEqual(parsed.length, 1);
  assert.deepStrictEqual(parsed[0].sort(), ['app.py', 'test_app.py']);
});
