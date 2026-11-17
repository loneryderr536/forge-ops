import test from 'node:test';
import assert from 'node:assert';
import { onEditApproval, editFileTool } from '../../src/mcp/tools/editTool';
import { EditStore } from '../../src/edits/store';
import { ReviewController } from '../../src/edits/review';
import type { ToolDeps } from '../../src/mcp/tools/toolDeps';

test('cancelAll_resolves_pending_as_deny', async () => {
  const store = new EditStore();
  const review = new ReviewController();
  const fakeDeps: Partial<ToolDeps> = {
    root: '/ws',
    async readText() {
      return 'line1\n';
    },
    store,
  };

  const p = onEditApproval(
    {
      threadId: 't1',
      toolCallId: 'c1',
      toolName: 'edit_file',
      args: { path: 'a.py', old_string: 'line1', new_string: 'line2' },
    },
    fakeDeps as ToolDeps,
    review
  );

  // Allow event loop tick for async readText to stage and enter review
  await new Promise((r) => setImmediate(r));

  review.cancelAll();
  const res = await p;
  assert.strictEqual(res.status, 'deny');
});

test('auto_deny_when_old_string_missing', async () => {
  const store = new EditStore();
  const review = new ReviewController();
  const fakeDeps: Partial<ToolDeps> = {
    root: '/ws',
    async readText() {
      return 'a\n';
    },
    store,
  };

  const res = await onEditApproval(
    {
      threadId: 't1',
      toolCallId: 'c1',
      toolName: 'edit_file',
      args: { path: 'a.py', old_string: 'zz', new_string: 'c' },
    },
    fakeDeps as ToolDeps,
    review
  );

  assert.strictEqual(res.status, 'deny');
  assert.match(res.reason || '', /not_found/);
});

test('editFileTool_refuses_unreviewed', async () => {
  const store = new EditStore();
  let written = false;
  const fakeDeps: Partial<ToolDeps> = {
    root: '/ws',
    store,
    async writeText() {
      written = true;
    },
  };

  const res = await editFileTool(
    { path: 'a.py', old_string: 'a', new_string: 'b' },
    fakeDeps as ToolDeps,
    'r1'
  );

  assert.strictEqual(res, 'refused: edit was not reviewed');
  assert.strictEqual(written, false);
});

test('editFileTool_applies_only_accepted', async () => {
  const store = new EditStore();
  let writtenText = '';
  const fakeDeps: Partial<ToolDeps> = {
    root: '/ws',
    store,
    async writeText(_, text) {
      writtenText = text;
    },
  };

  const before = 'a\nb\nc\nd\n';
  const stageRes = store.stage('a.py', before, 'a\nb\nc\nd', 'a\nB\nc\nD');
  assert.ok(stageRes.ok);
  if (stageRes.ok) {
    store.decide(stageRes.edit.key, ['h0']); // accept h0 only
    const res = await editFileTool(
      { path: 'a.py', old_string: 'a\nb\nc\nd', new_string: 'a\nB\nc\nD' },
      fakeDeps as ToolDeps,
      'r1'
    );
    assert.strictEqual(res, 'Applied 1 of 2 hunks to a.py; rejected: h1');
    assert.strictEqual(writtenText, 'a\nB\nc\nd\n');
  }
});
