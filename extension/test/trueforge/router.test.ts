import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { routeEvent } from '../../src/trueforge/router';
import type { TurnHandlers, ApprovalRequest } from '../../src/types';

function createDummyHandlers(): { handlers: TurnHandlers; textDeltas: string[]; toolCalls: any[]; threads: any[] } {
  const textDeltas: string[] = [];
  const toolCalls: any[] = [];
  const threads: any[] = [];

  const handlers: TurnHandlers = {
    onText(delta: string) {
      textDeltas.push(delta);
    },
    onToolCall(name: string, args: unknown, threadId: string) {
      toolCalls.push({ name, args, threadId });
    },
    onToolResult() {},
    onThread(kind: 'created' | 'done', threadId: string, status?: string) {
      threads.push({ kind, threadId, status });
    },
    async onApproval() {
      return { status: 'allow' };
    },
  };

  return { handlers, textDeltas, toolCalls, threads };
}

test('routes_text_deltas_in_order', () => {
  const fixturePath = new URL('../fixtures/stream-basic.json', import.meta.url);
  const events = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  const index = new Map<string, any>();
  const { handlers, textDeltas } = createDummyHandlers();

  for (const ev of events) {
    routeEvent(index, ev, handlers);
  }

  assert.strictEqual(textDeltas.join(''), 'Hello there!');
});

test('routes_approval_with_tool_name_and_args', () => {
  const fixturePath = new URL('../fixtures/stream-approval.json', import.meta.url);
  const events = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  const index = new Map<string, any>();
  const { handlers } = createDummyHandlers();
  let approvalReqs: ApprovalRequest[] = [];

  for (const ev of events) {
    const res = routeEvent(index, ev, handlers);
    if (res.approvals) {
      approvalReqs.push(...res.approvals);
    }
  }

  assert.strictEqual(approvalReqs.length, 1);
  assert.strictEqual(approvalReqs[0].toolName, 'edit_file');
  assert.deepStrictEqual(approvalReqs[0].args, {
    path: 'a.py',
    old_string: 'foo',
    new_string: 'bar',
  });
  assert.strictEqual(approvalReqs[0].threadId, 'root');
});

test('routes_done_error_message', () => {
  const index = new Map<string, any>();
  const { handlers } = createDummyHandlers();

  const ev = {
    type: 'turn.done',
    state: { status: 'error', message: '401' },
  };

  const res = routeEvent(index, ev, handlers);
  assert.deepStrictEqual(res.done, {
    status: 'error',
    message: '401',
  });
});

test('routes_subagent_thread_events', () => {
  const index = new Map<string, any>();
  const { handlers, threads } = createDummyHandlers();

  routeEvent(index, { type: 'thread.created', thread_id: 'sub-1', status: 'running' }, handlers);
  routeEvent(index, { type: 'thread.done', thread_id: 'sub-1', status: 'success' }, handlers);

  assert.strictEqual(threads.length, 2);
  assert.deepStrictEqual(threads[0], { kind: 'created', threadId: 'sub-1', status: 'running' });
  assert.deepStrictEqual(threads[1], { kind: 'done', threadId: 'sub-1', status: 'success' });
});
