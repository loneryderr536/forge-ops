import test from 'node:test';
import assert from 'node:assert';
import { applyReplace, computeHunks, applySelectedHunks } from '../../src/edits/apply';

test('applyReplace_basic', () => {
  assert.deepStrictEqual(applyReplace('a\nb\n', 'b', 'c'), { ok: true, text: 'a\nc\n' });
});

test('applyReplace_not_found', () => {
  assert.deepStrictEqual(applyReplace('a\n', 'zz', 'c'), { ok: false, reason: 'not_found' });
});

test('applyReplace_ambiguous', () => {
  assert.deepStrictEqual(applyReplace('x\nx\n', 'x', 'y'), { ok: false, reason: 'ambiguous' });
});

test('applyReplace_handles_crlf', () => {
  assert.deepStrictEqual(applyReplace('a\r\nb\r\n', 'a\nb', 'a\nc'), { ok: true, text: 'a\r\nc\r\n' });
});

test('computeHunks_two_regions', () => {
  const h = computeHunks('a\nb\nc\nd\n', 'a\nB\nc\nD\n');
  assert.deepStrictEqual(h.map((x) => x.id), ['h0', 'h1']);
  assert.strictEqual(h[0].oldStart, 2);
  assert.deepStrictEqual(h[0].oldLines, ['b']);
  assert.deepStrictEqual(h[0].newLines, ['B']);
});

test('applySelectedHunks_partial', () => {
  assert.strictEqual(
    applySelectedHunks('a\nb\nc\nd\n', 'a\nB\nc\nD\n', ['h0']),
    'a\nB\nc\nd\n'
  );
});

test('applySelectedHunks_none_is_identity', () => {
  assert.strictEqual(applySelectedHunks('a\nb\n', 'a\nc\n', []), 'a\nb\n');
});
