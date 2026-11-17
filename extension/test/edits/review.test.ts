import test from 'node:test';
import assert from 'node:assert';
import { ReviewController } from '../../src/edits/review';
import type { ProposedEdit } from '../../src/types';

test('cancelAll_resolves_pending_as_cancelled', async () => {
  const review = new ReviewController();
  const fakeEdit: ProposedEdit = {
    key: 'k1',
    path: 'a.py',
    before: 'a\n',
    after: 'b\n',
    hunks: [{ id: 'h0', oldStart: 1, oldLines: ['a'], newLines: ['b'] }],
  };

  const p = review.review(fakeEdit);
  review.cancelAll();
  const res = await p;
  assert.strictEqual(res, 'cancelled');
});

test('review_accept_and_complete', async () => {
  const review = new ReviewController();
  const fakeEdit: ProposedEdit = {
    key: 'k2',
    path: 'a.py',
    before: 'a\n',
    after: 'b\n',
    hunks: [{ id: 'h0', oldStart: 1, oldLines: ['a'], newLines: ['b'] }],
  };

  const p = review.review(fakeEdit);
  review.completeReview('k2', true);
  const res = await p;
  assert.deepStrictEqual(res, ['h0']);
});
