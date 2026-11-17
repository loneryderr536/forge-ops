import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { ForgeClient } from '../../src/trueforge/client';

const sse = (ev: unknown) => `data: ${JSON.stringify(ev)}\n\n`;

test('runTurn_resumes_stream_after_approval_pause', async () => {
  const decisions: any[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url!.endsWith('/turns')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(sse({ id: 'e1', type: 'turn.created', turn_id: 't1' }));
        res.write(sse({ id: 'e2', type: 'model.message', tool_calls: [{ id: 'c1', function: { name: 'edit_file', arguments: '{"path":"a.py"}' } }] }));
        res.write(sse({ id: 'e3', type: 'tool.approval_required', thread_id: 'root', tool_calls: [{ id: 'c1', source_event_id: 'e2' }] }));
        res.write(sse({ id: 'e4', type: 'turn.done', state: { status: 'paused' } }));
        res.end(); // server pauses: stream closes
      } else if (req.method === 'POST' && req.url!.endsWith('/events')) {
        decisions.push(JSON.parse(body));
        res.writeHead(200).end('{}');
      } else if (req.method === 'GET' && req.url!.includes('/turns/t1/subscribe?after_event_id=e4')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(sse({ id: 'e5', type: 'turn.done', state: { status: 'done' } }));
        res.end();
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  try {
    const client = new ForgeClient(`http://127.0.0.1:${port}`);
    const seen: string[] = [];
    const result = await client.runTurn('s1', 'hi', {
      onText() {}, onToolCall() {}, onToolResult() {}, onThread() {},
      async onApproval(req) { seen.push(req.toolName); return { status: 'allow' }; },
    } as any);
    assert.equal(result.status, 'completed');
    assert.deepEqual(seen, ['edit_file']);
    assert.equal(decisions[0].events[0].approval.status, 'allow');
    assert.equal(decisions[0].events[0].tool_call_id, 'c1');
    assert.equal(decisions[0].events[0].thread_id, 'root');
  } finally {
    server.close();
  }
});

test('runTurn_denies_when_approval_handler_throws', async () => {
  const decisions: any[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url!.endsWith('/turns')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(sse({ id: 'e1', type: 'turn.created', turn_id: 't1' }));
        res.write(sse({ id: 'e2', type: 'model.message', tool_calls: [{ id: 'c1', function: { name: 'edit_file', arguments: '{}' } }] }));
        res.write(sse({ id: 'e3', type: 'tool.approval_required', tool_calls: [{ id: 'c1', source_event_id: 'e2' }] }));
        res.write(sse({ id: 'e4', type: 'turn.done', state: { status: 'completed' } }));
        res.end();
      } else {
        decisions.push(JSON.parse(body));
        res.writeHead(200).end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  try {
    const client = new ForgeClient(`http://127.0.0.1:${port}`);
    const result = await client.runTurn('s1', 'hi', {
      onText() {}, onToolCall() {}, onToolResult() {}, onThread() {},
      async onApproval() { throw new Error('boom'); },
    } as any);
    assert.equal(result.status, 'completed');
    assert.equal(decisions[0].events[0].approval.status, 'deny');
  } finally {
    server.close();
  }
});
