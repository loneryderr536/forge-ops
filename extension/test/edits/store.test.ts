import test from 'node:test';
import assert from 'node:assert';
import { EditStore, editKey } from '../../src/edits/store';

test('stage_not_found', () => {
  const store = new EditStore();
  assert.deepStrictEqual(store.stage('a.py', 'x\n', 'zz', 'y'), { ok: false, reason: 'not_found' });
});

test('stage_then_decide_then_take', () => {
  const store = new EditStore();
  const res = store.stage('a.py', 'x\n', 'x', 'y');
  assert.strictEqual(res.ok, true);
  if (res.ok) {
    store.decide(res.edit.key, ['h0']);
    const taken = store.takeDecision(res.edit.key);
    assert.ok(taken);
    assert.deepStrictEqual(taken.acceptedIds, ['h0']);
  }
});

test('takeDecision_is_single_use', () => {
  const store = new EditStore();
  const res = store.stage('a.py', 'x\n', 'x', 'y');
  assert.strictEqual(res.ok, true);
  if (res.ok) {
    store.decide(res.edit.key, ['h0']);
    const taken1 = store.takeDecision(res.edit.key);
    assert.ok(taken1);
    const taken2 = store.takeDecision(res.edit.key);
    assert.strictEqual(taken2, undefined);
  }
});

test('checkpoint_first_wins_and_undo', () => {
  const store = new EditStore();
  store.recordCheckpoint('r1', 'a.py', 'v1');
  store.recordCheckpoint('r1', 'a.py', 'v2');
  const undoMap = store.undoRun('r1');
  assert.strictEqual(undoMap.get('a.py'), 'v1');
});

test('discardPending_clears_undecided', () => {
  const store = new EditStore();
  const res = store.stage('a.py', 'x\n', 'x', 'y');
  assert.strictEqual(res.ok, true);
  if (res.ok) {
    store.decide(res.edit.key, ['h0']);
    store.discardPending();
    const taken = store.takeDecision(res.edit.key);
    assert.strictEqual(taken, undefined);
  }
});
