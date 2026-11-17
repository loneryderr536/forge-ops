import test from 'node:test';
import assert from 'node:assert';
import { runWithFallback } from '../../src/trueforge/fallback';
import type { TurnResult } from '../../src/types';

test('auth_error_falls_back_without_retry', async () => {
  let callCount = 0;
  let notifyText = '';

  const attempt = async (model: string): Promise<TurnResult> => {
    callCount++;
    if (model === 'm1') {
      return { status: 'error', message: '401 invalid api key', sessionId: 's1' };
    }
    return { status: 'completed', sessionId: 's2' };
  };

  const res = await runWithFallback(
    ['m1', 'm2'],
    attempt,
    (notice) => {
      notifyText = notice;
    },
    async () => {}
  );

  assert.strictEqual(res.model, 'm2');
  assert.strictEqual(res.status, 'completed');
  assert.strictEqual(callCount, 2);
  assert.match(notifyText, /m1 failed.*Switched to fallback m2/);
});

test('transient_retries_once_then_falls_back', async () => {
  let callCount = 0;
  let sleptMs = 0;

  const attempt = async (model: string): Promise<TurnResult> => {
    callCount++;
    if (model === 'm1') {
      return { status: 'error', message: '503 service unavailable', sessionId: 's1' };
    }
    return { status: 'completed', sessionId: 's2' };
  };

  const res = await runWithFallback(
    ['m1', 'm2'],
    attempt,
    () => {},
    async (ms) => {
      sleptMs = ms;
    }
  );

  assert.strictEqual(res.model, 'm2');
  assert.strictEqual(callCount, 3); // m1 initial, m1 retry, m2 fallback
  assert.strictEqual(sleptMs, 1500);
});

test('all_fail_returns_last_error', async () => {
  const attempt = async (): Promise<TurnResult> => {
    return { status: 'error', message: 'fatal connection failure', sessionId: '' };
  };

  const res = await runWithFallback(['m1', 'm2'], attempt, () => {});
  assert.strictEqual(res.status, 'error');
  assert.strictEqual(res.model, 'm2');
});

test('cancelled_is_not_retried', async () => {
  let callCount = 0;
  const attempt = async (): Promise<TurnResult> => {
    callCount++;
    return { status: 'cancelled', sessionId: 's1' };
  };

  const res = await runWithFallback(['m1', 'm2'], attempt, () => {});
  assert.strictEqual(res.status, 'cancelled');
  assert.strictEqual(callCount, 1);
});
