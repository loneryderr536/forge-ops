import test from 'node:test';
import assert from 'node:assert';
import { tokenize } from '../../src/stats/tokenize';
import { chunkFile } from '../../src/stats/chunk';
import { Bm25Index } from '../../src/stats/bm25';

test('tokenize_snake_and_camel', () => {
  assert.deepStrictEqual(
    tokenize('get_debug_flag FlaskGroup'),
    ['get', 'debug', 'flag', 'flask', 'group']
  );
});

test('chunk_python_by_def', () => {
  const code = 'import x\n\ndef a():\n  pass\n\nclass B:\n  pass\n';
  const chunks = chunkFile('app.py', code);
  assert.strictEqual(chunks.length, 3);
  assert.deepStrictEqual(chunks.map((c) => c.startLine), [1, 3, 6]);
});

test('bm25_ranks_relevant_file_first', () => {
  const chunks = [
    ...chunkFile('cli.py', 'def routes_command():\n  """Show routes command"""'),
    ...chunkFile('helpers.py', 'def get_debug_flag():\n  pass'),
  ];
  const idx = new Bm25Index(chunks);
  const s = idx.scoreFiles('cli command');
  const cliScore = s.get('cli.py')?.score ?? 0;
  const helpersScore = s.get('helpers.py')?.score ?? 0;
  assert.ok(cliScore > helpersScore);
});
