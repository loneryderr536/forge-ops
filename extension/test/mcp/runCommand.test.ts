import test from 'node:test';
import assert from 'node:assert';
import { runCommand } from '../../src/mcp/tools/runCommand';

test('runCommand captures_exit_code', async () => {
  const res = await runCommand('node -e "process.exit(3)"', process.cwd(), 10);
  assert.strictEqual(res.exitCode, 3);
});

test('runCommand tails_output_to_4096_bytes', async () => {
  const res = await runCommand('node -e "console.log(\'x\'.repeat(10000))"', process.cwd(), 10);
  assert.ok(res.output.length <= 4096);
  assert.ok(res.output.endsWith('x\n') || res.output.endsWith('x'));
});

test('runCommand times_out', async () => {
  const res = await runCommand('node -e "setTimeout(()=>{}, 4000)"', process.cwd(), 1);
  assert.strictEqual(res.timedOut, true);
});

test('runCommand abort_kills', async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  const res = await runCommand('node -e "setTimeout(()=>{}, 4000)"', process.cwd(), 10, ac.signal);
  assert.strictEqual(res.exitCode, null);
});
