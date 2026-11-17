import test from 'node:test';
import assert from 'node:assert';
import { parseMentions } from '../../src/context/mentions';

test('parseMentions', () => {
  const res = parseMentions('fix @src/a.py and @#run_command now');
  assert.deepStrictEqual(res, {
    files: ['src/a.py'],
    symbols: ['run_command'],
    rest: 'fix and now',
  });
});
