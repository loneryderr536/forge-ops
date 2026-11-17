import test from 'node:test';
import assert from 'node:assert';
import { buildImportGraph } from '../../src/stats/imports';

test('imports_resolve_relative_and_absolute', () => {
  const files = new Map([
    [
      'src/flask/cli.py',
      'from .helpers import get_debug_flag\nfrom flask.config import Config',
    ],
    ['src/flask/helpers.py', ''],
    ['src/flask/config.py', ''],
  ]);

  const g = buildImportGraph(files, ['src']);
  const neighbors = Array.from(g.get('src/flask/cli.py') || []).sort();
  assert.deepStrictEqual(neighbors, ['src/flask/config.py', 'src/flask/helpers.py']);
});
