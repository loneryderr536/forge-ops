export interface Hunk {
  id: string; // "h0", "h1", ... in file order
  oldStart: number;
  oldLines: string[];
  newLines: string[];
}

export interface ProposedEdit {
  key: string;
  path: string;
  before: string;
  after: string;
  hunks: Hunk[];
}

export type StageResult =
  | { ok: true; edit: ProposedEdit }
  | { ok: false; reason: 'not_found' | 'ambiguous' };

export interface RankedFile {
  path: string;
  score: number;
  evidence: string;
}

export interface CommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export interface ApprovalRequest {
  threadId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export type ApprovalDecision =
  | { status: 'allow' }
  | { status: 'deny'; reason?: string };

export interface TurnResult {
  status: 'completed' | 'error' | 'cancelled';
  message?: string;
  sessionId: string;
}

export interface TurnHandlers {
  onText(delta: string): void;
  onToolCall(name: string, args: unknown, threadId: string): void;
  onToolResult(name: string, summary: string, threadId: string): void;
  onThread(kind: 'created' | 'done', threadId: string, status?: string): void;
  onApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}
