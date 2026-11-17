import test from 'node:test';
import assert from 'node:assert';
import { rankFiles } from '../../src/stats/rank';
import { buildRepoMap } from '../../src/stats/repoMap';
import { estimateTokens } from '../../src/context/budget';

test('rank_combines_signals', () => {
  const bm25 = new Map([
    ['src/flask/cli.py', { score: 10.0, hits: 23 }],
    ['tests/test_cli.py', { score: 2.0, hits: 2 }],
    ['docs/cli.rst', { score: 1.0, hits: 1 }],
  ]);

  const commits = [
    ['src/flask/cli.py', 'tests/test_cli.py'],
    ['src/flask/cli.py', 'tests/test_cli.py'],
    ['src/flask/cli.py', 'docs/cli.rst'],
  ];

  const imports = new Map<string, Set<string>>();

  const ranked = rankFiles('cli command', bm25, commits, imports, 8);
  assert.strictEqual(ranked[0].path, 'src/flask/cli.py');
  assert.strictEqual(ranked[1].path, 'tests/test_cli.py');
  assert.match(ranked[1].evidence, /changed with src\/flask\/cli\.py in 67%/);
});

test('rank_caps_at_k_and_8', () => {
  const bm25 = new Map<string, { score: number; hits: number }>();
  for (let i = 0; i < 20; i++) {
    bm25.set(`file_${i}.py`, { score: 20 - i, hits: 1 });
  }

  const ranked = rankFiles('test', bm25, [], new Map(), 20);
  assert.strictEqual(ranked.length, 8);
});

test('repoMap_respects_budget', () => {
  const files = new Map<string, string>();
  for (let i = 0; i < 500; i++) {
    files.set(`src/pkg/module_${i}.py`, `def func_${i}():\n  pass\n`);
  }

  const map = buildRepoMap(files, 3000);
  const tokenEstimate = estimateTokens(map);
  assert.ok(tokenEstimate <= 3000);
});
