import * as vscode from 'vscode';
import * as path from 'node:path';
import type { ProposedEdit } from '../types';
import type { ReviewController } from './review';

const SCHEME = 'forge-ops-proposed';

/**
 * Editor-side per-hunk review: red line decorations for removed lines, a hover
 * with the proposed text, and CodeLens controls (Accept/Reject per hunk, plus
 * Apply / Reject all / View diff at the top of the file).
 */
export class ReviewUi implements vscode.CodeLensProvider, vscode.TextDocumentContentProvider {
  private readonly lensEmitter = new vscode.EventEmitter<void>();
  private readonly contentEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeCodeLenses = this.lensEmitter.event;
  readonly onDidChange = this.contentEmitter.event;

  private active = new Map<string, { edit: ProposedEdit; controller: ReviewController }>();
  private readonly removedDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
    isWholeLine: true,
  });
  private readonly addedDeco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('gitDecoration.addedResourceForeground'), margin: '0 0 0 2em' },
  });

  constructor(private readonly root: string) {}

  register(context: vscode.ExtensionContext, controllerRef: () => ReviewController): void {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      vscode.commands.registerCommand('forge-ops.review.toggle', (key: string, hunkId: string, accept: boolean) => {
        controllerRef().setHunkDecision(key, hunkId, accept);
        this.refresh();
      }),
      vscode.commands.registerCommand('forge-ops.review.finish', (key: string) => {
        controllerRef().completeReview(key);
        this.drop(key);
      }),
      vscode.commands.registerCommand('forge-ops.review.rejectAll', (key: string) => {
        controllerRef().rejectReview(key);
        this.drop(key);
      }),
      vscode.commands.registerCommand('forge-ops.review.diff', async (key: string) => {
        const item = this.active.get(key);
        if (!item) return;
        const left = vscode.Uri.file(this.abs(item.edit.path));
        const right = vscode.Uri.parse(`${SCHEME}:/${item.edit.path}?key=${key}`);
        await vscode.commands.executeCommand('vscode.diff', left, right, `Forge-ops: ${item.edit.path} (proposed)`);
      }),
      this.removedDeco,
      this.addedDeco,
    );
  }

  /** Callback for ReviewController: open the file and show the proposal. */
  async show(edit: ProposedEdit, controller: ReviewController): Promise<void> {
    this.active.set(edit.key, { edit, controller });
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this.abs(edit.path)));
    await vscode.window.showTextDocument(doc, { preview: false });
    this.refresh();
    vscode.window.setStatusBarMessage(
      `Forge-ops: review ${edit.hunks.length} hunk(s) in ${edit.path} — use the CodeLens above the code.`,
      8000
    );
  }

  /** Drop reviews the controller no longer holds (cancel/stop). */
  refresh(): void {
    for (const [key, item] of this.active) {
      if (!item.controller.getPending(key)) this.active.delete(key);
    }
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorate(editor);
    }
    this.lensEmitter.fire();
  }

  private drop(key: string): void {
    this.active.delete(key);
    this.refresh();
  }

  private abs(rel: string): string {
    return path.resolve(this.root, rel);
  }

  private forDoc(doc: vscode.TextDocument) {
    return [...this.active.entries()].filter(([, v]) => this.abs(v.edit.path) === doc.uri.fsPath);
  }

  private anchor(doc: vscode.TextDocument, oldStart: number): number {
    return Math.max(0, Math.min(oldStart - 1, doc.lineCount - 1));
  }

  private decorate(editor: vscode.TextEditor): void {
    const removed: vscode.DecorationOptions[] = [];
    const added: vscode.DecorationOptions[] = [];
    for (const [key, { edit, controller }] of this.forDoc(editor.document)) {
      const decisions = controller.getDecisions(key);
      for (const h of edit.hunks) {
        const accepted = decisions?.get(h.id) !== false;
        const first = this.anchor(editor.document, h.oldStart);
        const md = new vscode.MarkdownString();
        md.appendCodeblock(h.newLines.join('\n') || '(deleted)', 'text');
        if (h.oldLines.length > 0) {
          const last = Math.min(first + h.oldLines.length - 1, editor.document.lineCount - 1);
          removed.push({ range: new vscode.Range(first, 0, last, 0), hoverMessage: md });
        }
        if (h.newLines.length > 0) {
          const line = h.oldLines.length > 0
            ? Math.min(first + h.oldLines.length - 1, editor.document.lineCount - 1)
            : first;
          added.push({
            range: new vscode.Range(line, 0, line, 0),
            renderOptions: {
              after: { contentText: `  ➜ ${accepted ? '✓' : '✗'} +${h.newLines.length}: ${h.newLines[0].trim().slice(0, 60)}` },
            },
          });
        }
      }
    }
    editor.setDecorations(this.removedDeco, removed);
    editor.setDecorations(this.addedDeco, added);
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (const [key, { edit, controller }] of this.forDoc(doc)) {
      const decisions = controller.getDecisions(key);
      const acceptedCount = edit.hunks.filter((h) => decisions?.get(h.id) !== false).length;
      const top = new vscode.Range(this.anchor(doc, edit.hunks[0]?.oldStart ?? 1), 0, this.anchor(doc, edit.hunks[0]?.oldStart ?? 1), 0);
      lenses.push(
        new vscode.CodeLens(top, { title: `$(check-all) Apply ${acceptedCount}/${edit.hunks.length} hunk(s)`, command: 'forge-ops.review.finish', arguments: [key] }),
        new vscode.CodeLens(top, { title: '$(close-all) Reject all', command: 'forge-ops.review.rejectAll', arguments: [key] }),
        new vscode.CodeLens(top, { title: '$(diff) View diff', command: 'forge-ops.review.diff', arguments: [key] }),
      );
      for (const h of edit.hunks) {
        const r = new vscode.Range(this.anchor(doc, h.oldStart), 0, this.anchor(doc, h.oldStart), 0);
        const accepted = decisions?.get(h.id) !== false;
        lenses.push(
          new vscode.CodeLens(r, {
            title: accepted ? '✓ Accept (selected)' : '✓ Accept',
            command: 'forge-ops.review.toggle',
            arguments: [key, h.id, true],
          }),
          new vscode.CodeLens(r, {
            title: accepted ? '✗ Reject' : '✗ Reject (selected)',
            command: 'forge-ops.review.toggle',
            arguments: [key, h.id, false],
          }),
        );
      }
    }
    return lenses;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = new URLSearchParams(uri.query).get('key') ?? '';
    return this.active.get(key)?.edit.after ?? '';
  }
}
