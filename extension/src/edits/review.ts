import type { ProposedEdit } from '../types';

interface PendingReview {
  edit: ProposedEdit;
  resolve: (value: string[] | 'cancelled') => void;
  decisionMap: Map<string, boolean>; // hunkId -> accepted
}

export class ReviewController {
  private pending = new Map<string, PendingReview>();
  private onReviewCallback?: (edit: ProposedEdit, controller: ReviewController) => void;

  constructor(onReview?: (edit: ProposedEdit, controller: ReviewController) => void) {
    this.onReviewCallback = onReview;
  }

  review(edit: ProposedEdit): Promise<string[] | 'cancelled'> {
    return new Promise((resolve) => {
      const decisionMap = new Map<string, boolean>();
      for (const hunk of edit.hunks) {
        decisionMap.set(hunk.id, true); // default accept all
      }

      this.pending.set(edit.key, {
        edit,
        resolve,
        decisionMap,
      });

      if (this.onReviewCallback) {
        this.onReviewCallback(edit, this);
      }
    });
  }

  setHunkDecision(editKey: string, hunkId: string, accept: boolean): void {
    const item = this.pending.get(editKey);
    if (!item) return;
    item.decisionMap.set(hunkId, accept);
  }

  completeReview(editKey: string, acceptAll?: boolean): void {
    const item = this.pending.get(editKey);
    if (!item) return;

    this.pending.delete(editKey);
    if (acceptAll === false) {
      item.resolve([]);
      return;
    }

    const accepted: string[] = [];
    for (const [id, isAccepted] of item.decisionMap.entries()) {
      if (isAccepted) {
        accepted.push(id);
      }
    }
    item.resolve(accepted);
  }

  rejectReview(editKey: string): void {
    const item = this.pending.get(editKey);
    if (!item) return;
    this.pending.delete(editKey);
    item.resolve([]);
  }

  cancelAll(): void {
    for (const [, item] of this.pending) {
      item.resolve('cancelled');
    }
    this.pending.clear();
  }

  getPending(editKey: string): ProposedEdit | undefined {
    return this.pending.get(editKey)?.edit;
  }
}
