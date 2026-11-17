import type { ApprovalDecision, ApprovalRequest } from '../../types';
import { resolveInWorkspace } from '../guards';
import type { ToolDeps } from './toolDeps';
import { editKey } from '../../edits/store';
import { applySelectedHunks } from '../../edits/apply';
import { ReviewController } from '../../edits/review';

export async function onEditApproval(
  req: ApprovalRequest,
  deps: ToolDeps,
  review: ReviewController
): Promise<ApprovalDecision> {
  const pathArg = String(req.args.path ?? '');
  const oldString = String(req.args.old_string ?? '');
  const newString = String(req.args.new_string ?? '');

  let absPath: string;
  try {
    absPath = resolveInWorkspace(deps.root, pathArg);
  } catch {
    return { status: 'deny', reason: `path ${pathArg} is outside workspace` };
  }

  const currentText = await deps.readText(absPath);
  const stageRes = deps.store.stage(pathArg, currentText, oldString, newString);

  if (!stageRes.ok) {
    return {
      status: 'deny',
      reason: `old_string ${stageRes.reason} in ${pathArg}; re-read the file with read_file`,
    };
  }

  const reviewRes = await review.review(stageRes.edit);
  if (reviewRes === 'cancelled' || reviewRes.length === 0) {
    return { status: 'deny', reason: 'user rejected all hunks' };
  }

  deps.store.decide(stageRes.edit.key, reviewRes);
  return { status: 'allow' };
}

export async function editFileTool(
  args: { path: string; old_string: string; new_string: string },
  deps: ToolDeps,
  runId: string
): Promise<string> {
  const key = editKey(args.path, args.old_string, args.new_string);
  const decision = deps.store.takeDecision(key);

  if (!decision) {
    return 'refused: edit was not reviewed';
  }

  const absPath = resolveInWorkspace(deps.root, args.path);
  deps.store.recordCheckpoint(runId, args.path, decision.edit.before);

  const newText = applySelectedHunks(
    decision.edit.before,
    decision.edit.after,
    decision.acceptedIds
  );

  await deps.writeText(absPath, newText);

  const total = decision.edit.hunks.length;
  const accepted = decision.acceptedIds.length;
  const rejected = decision.edit.hunks
    .filter((h) => !decision.acceptedIds.includes(h.id))
    .map((h) => h.id);

  if (rejected.length > 0) {
    return `Applied ${accepted} of ${total} hunks to ${args.path}; rejected: ${rejected.join(', ')}`;
  }
  return `Applied ${accepted} of ${total} hunks to ${args.path}`;
}
