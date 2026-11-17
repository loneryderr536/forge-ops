import test from 'node:test';
import assert from 'node:assert';
import { resolveInWorkspace } from '../../src/mcp/guards';

test('resolveInWorkspace_rejects_escape', () => {
  assert.throws(() => resolveInWorkspace('/ws', '../etc/passwd'), /path outside workspace/);
});

test('resolveInWorkspace_accepts_absolute_inside', () => {
  assert.strictEqual(resolveInWorkspace('/ws', '/ws/src/a.py'), '/ws/src/a.py');
});

test('resolveInWorkspace_normalizes_backslashes', () => {
  assert.strictEqual(resolveInWorkspace('/ws', 'src\\flask\\cli.py'), '/ws/src/flask/cli.py');
});
