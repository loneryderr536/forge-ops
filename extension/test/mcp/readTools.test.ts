import test from 'node:test';
import assert from 'node:assert';
import { readFileTool, searchTool } from '../../src/mcp/tools/readTools';
import type { ToolDeps } from '../../src/mcp/tools/toolDeps';

test('read_file_caps_300_lines', async () => {
  const fake1000 = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n');
  const fakeDeps: Partial<ToolDeps> = {
    root: '/ws',
    async readText() {
      return fake1000;
    },
  };

  const res = await readFileTool({ path: 'test.py' }, fakeDeps as ToolDeps);
  const lines = res.split('\n');
  assert.strictEqual(lines.length, 301);
  assert.match(lines[300], /… truncated/);
});

test('search_caps_50_hits', async () => {
  const fakeFiles = Array.from({ length: 10 }, (_, i) => `src/file_${i}.py`);
  const fakeDeps: Partial<ToolDeps> = {
    root: '/ws',
    async listFiles() {
      return fakeFiles;
    },
    async readText() {
      // 8 matches per file -> 80 total
      return Array.from({ length: 8 }, (_, i) => `def match_func_${i}(): pass`).join('\n');
    },
  };

  const res = await searchTool({ query: 'match_func' }, fakeDeps as ToolDeps);
  const hits = res.split('\n').filter(Boolean);
  assert.strictEqual(hits.length, 50);
  assert.match(hits[0], /^src\/file_0\.py:1: def match_func_0/);
});
