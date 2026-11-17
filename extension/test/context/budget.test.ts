import test from 'node:test';
import assert from 'node:assert';
import { estimateTokens, ContextMeter } from '../../src/context/budget.ts';

test('estimateTokens', () => {
  assert.strictEqual(estimateTokens('abcdefgh'), 2);
});

test('meter_counts_distinct_files', () => {
  const meter = new ContextMeter(25000);
  meter.add('src/a.py', 'code line');
  meter.add('src/a.py', 'another line');
  meter.add('src/b.py', 'third line');
  const snap = meter.snapshot();
  assert.strictEqual(snap.files, 2);
  assert.ok(snap.used > 0);
});
