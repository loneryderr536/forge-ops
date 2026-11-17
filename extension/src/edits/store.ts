import * as crypto from 'node:crypto';
import type { ProposedEdit, StageResult } from '../types';
import { applyReplace, computeHunks } from './apply';

export function editKey(path: string, oldStr: string, newStr: string): string {
  const hash = crypto.createHash('sha1');
  hash.update(`${path}\0${oldStr}\0${newStr}`);
  return hash.digest('hex');
}

export class EditStore {
  private stagedEdits = new Map<string, ProposedEdit>();
  private decisions = new Map<string, string[]>();
  // runId -> Map<path, originalText>
  private checkpoints = new Map<string, Map<string, string>>();

  stage(path: string, currentText: string, oldStr: string, newStr: string): StageResult {
    const replaceRes = applyReplace(currentText, oldStr, newStr);
    if (!replaceRes.ok) {
      return { ok: false, reason: replaceRes.reason };
    }

    const key = editKey(path, oldStr, newStr);
    const hunks = computeHunks(currentText, replaceRes.text);
    const edit: ProposedEdit = {
      key,
      path,
      before: currentText,
      after: replaceRes.text,
      hunks,
    };

    this.stagedEdits.set(key, edit);
    return { ok: true, edit };
  }

  decide(key: string, acceptedIds: string[]): void {
    this.decisions.set(key, acceptedIds);
  }

  takeDecision(key: string): { edit: ProposedEdit; acceptedIds: string[] } | undefined {
    if (!this.decisions.has(key)) {
      return undefined;
    }
    const acceptedIds = this.decisions.get(key)!;
    const edit = this.stagedEdits.get(key);
    this.decisions.delete(key);
    this.stagedEdits.delete(key);

    if (!edit) {
      return undefined;
    }
    return { edit, acceptedIds };
  }

  recordCheckpoint(runId: string, path: string, originalText: string): void {
    let runMap = this.checkpoints.get(runId);
    if (!runMap) {
      runMap = new Map<string, string>();
      this.checkpoints.set(runId, runMap);
    }
    if (!runMap.has(path)) {
      runMap.set(path, originalText);
    }
  }

  undoRun(runId: string): Map<string, string> {
    const runMap = this.checkpoints.get(runId);
    if (!runMap) {
      return new Map();
    }
    return new Map(runMap);
  }

  touchedIn(runId: string): string[] {
    const runMap = this.checkpoints.get(runId);
    if (!runMap) {
      return [];
    }
    return Array.from(runMap.keys());
  }

  discardPending(): void {
    this.stagedEdits.clear();
    this.decisions.clear();
  }
}
