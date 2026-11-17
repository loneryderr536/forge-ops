import * as vscode from 'vscode';
import { EditStore } from './edits/store';
import { ReviewController } from './edits/review';
import { ReviewUi } from './edits/reviewUi';
import { ContextMeter } from './context/budget';
import { parseMentions } from './context/mentions';
import { ForgeClient } from './trueforge/client';
import { runWithFallback } from './trueforge/fallback';
import { loadAgentSpec } from './trueforge/specs';
import { startMcpServer, McpServerInstance } from './mcp/server';
import { registerMcpServer } from './mcp/register';
import { ToolDeps } from './mcp/tools/toolDeps';
import { StatsService } from './stats/service';
import { onEditApproval } from './mcp/tools/editTool';
import { runCommand } from './mcp/tools/runCommand';
import { buildInlinePrompt } from './inline/inlineEdit';
import { AgentPanelProvider } from './panel/AgentPanel';
import { ApprovalRequest, ApprovalDecision, TurnHandlers } from './types';

let mcpInstance: McpServerInstance | null = null;
let currentSessionId: string | null = null;
let currentRunId = 'run-1';
let currentAbortController: AbortController | null = null;

export async function activate(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  const store = new EditStore();
  const reviewUi = new ReviewUi(root);
  const review = new ReviewController((edit, controller) => {
    void reviewUi.show(edit, controller);
  });
  reviewUi.register(context, () => review);
  const meter = new ContextMeter(25000);

  const config = vscode.workspace.getConfiguration('groundwork');
  const trueforgeUrl = config.get<string>('trueforgeUrl') || 'http://localhost:8790';
  let models = config.get<string[]>('models') || [
    'gemini/gemini-2.5-flash',
    'groq/llama-3.3-70b-versatile',
    'ollama/qwen2.5-coder:7b',
  ];

  const client = new ForgeClient(trueforgeUrl);

  const deps: ToolDeps = {
    root,
    async readText(absPath: string): Promise<string> {
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.fsPath === absPath) {
          return doc.getText();
        }
      }
      const uri = vscode.Uri.file(absPath);
      const data = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder('utf-8').decode(data);
    },
    async listFiles(glob: string, max: number): Promise<string[]> {
      const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', max);
      return uris.map((u) => vscode.workspace.asRelativePath(u));
    },
    store,
    async writeText(absPath: string, text: string): Promise<void> {
      const uri = vscode.Uri.file(absPath);
      const edit = new vscode.WorkspaceEdit();
      const document = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      edit.replace(uri, fullRange, text);
      await vscode.workspace.applyEdit(edit);
      await document.save();
    },
    async runCommand(cmd: string, timeoutS: number, signal: AbortSignal) {
      return runCommand(cmd, root, timeoutS, signal);
    },
    stats: new StatsService({
      root,
      async listFiles(glob: string, max: number) {
        const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', max);
        return uris.map((u) => vscode.workspace.asRelativePath(u));
      },
      async readText(absPath: string) {
        const uri = vscode.Uri.file(absPath);
        const data = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder('utf-8').decode(data);
      },
      async runCommand(cmd: string, timeoutS: number, signal: AbortSignal) {
        return runCommand(cmd, root, timeoutS, signal);
      },
    }),
  };

  // Start MCP server inside extension
  try {
    mcpInstance = await startMcpServer(deps);
    await registerMcpServer(trueforgeUrl, 'groundwork-editor', mcpInstance.url, mcpInstance.token);
  } catch (err: any) {
    console.warn('MCP Server initialization error:', err.message);
    vscode.window.showWarningMessage(
      `Groundwork: could not register its tool server with TrueForge at ${trueforgeUrl} (${err.message}). Start TrueForge, then reload the window.`
    );
  }

  // Panel Provider
  const panelProvider = new AgentPanelProvider(context.extensionUri, async (msg) => {
    if (msg.type === 'send') {
      await runAgentTask(msg.text);
    } else if (msg.type === 'stop') {
      await stopCurrentTask();
    } else if (msg.type === 'undoRun') {
      await undoLastRun();
    }
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AgentPanelProvider.viewType, panelProvider)
  );

  async function createTurnHandlers(): Promise<TurnHandlers> {
    return {
      onText(delta: string) {
        panelProvider.post({ type: 'text', delta });
      },
      onToolCall(name: string, args: unknown, threadId: string) {
        panelProvider.post({ type: 'tool', name, detail: JSON.stringify(args), threadId });
      },
      onToolResult(name: string, summary: string, threadId: string) {
        meter.add(name, summary);
        panelProvider.post({ type: 'meter', ...meter.snapshot() });
      },
      onThread(kind: 'created' | 'done', threadId: string, status?: string) {
        panelProvider.post({ type: 'thread', kind, threadId, status });
      },
      async onApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
        if (req.toolName === 'edit_file') {
          return await onEditApproval(req, deps, review);
        }
        if (req.toolName === 'run_command') {
          const cmd = String(req.args.cmd || '');
          const choice = await vscode.window.showWarningMessage(
            `Groundwork wants to run command: ${cmd}`,
            { modal: false },
            'Allow',
            'Deny'
          );
          if (choice === 'Allow') {
            return { status: 'allow' };
          }
          return { status: 'deny', reason: 'User denied command execution' };
        }
        return { status: 'allow' };
      },
    };
  }

  async function runAgentTask(rawPrompt: string) {
    currentRunId = `run-${Date.now()}`;
    mcpInstance?.setRunId(currentRunId);
    currentAbortController = new AbortController();

    const { files, symbols, rest } = parseMentions(rawPrompt);
    let finalPrompt = rest;
    if (files.length > 0 || symbols.length > 0) {
      finalPrompt = `[Pinned context: ${files.concat(symbols).join(', ')}]\n` + rest;
    }

    meter.reset();
    panelProvider.post({ type: 'meter', ...meter.snapshot() });

    const handlers = await createTurnHandlers();

    const result = await runWithFallback(
      models,
      async (modelName) => {
        const spec = loadAgentSpec('Forge-ops', modelName);
        const sessId = await client.startSession({ spec });
        currentSessionId = sessId;
        return await client.runTurn(sessId, finalPrompt, handlers, 20000, currentAbortController?.signal);
      },
      (notice) => {
        panelProvider.post({ type: 'banner', level: 'warn', text: notice });
        store.discardPending();
        review.cancelAll();
        reviewUi.refresh();
      }
    );

    panelProvider.post({ type: 'done', status: result.status });

    if (result.status === 'error') {
      panelProvider.post({
        type: 'banner',
        level: 'error',
        text: `Error: ${result.message || 'Run failed'}. No files were changed.`,
      });
      vscode.window.showErrorMessage(`Groundwork task failed: ${result.message}`);
    }
  }

  async function stopCurrentTask() {
    if (currentSessionId) {
      await client.cancel(currentSessionId);
    }
    review.cancelAll();
    reviewUi.refresh();
    store.discardPending();
    currentAbortController?.abort();

    const touched = store.touchedIn(currentRunId);
    if (touched.length > 0) {
      const choice = await vscode.window.showInformationMessage(
        'Cancelled. Some hunks were applied during this run.',
        'Keep',
        'Revert run'
      );
      if (choice === 'Revert run') {
        await undoLastRun();
      }
    } else {
      vscode.window.showInformationMessage('Cancelled. No pending changes were written.');
    }

    panelProvider.post({
      type: 'banner',
      level: 'info',
      text: 'Run cancelled. Workspace clean.',
    });
    panelProvider.post({ type: 'done', status: 'cancelled' });
  }

  async function undoLastRun() {
    const rolledBack = store.undoRun(currentRunId);
    if (rolledBack.size === 0) {
      vscode.window.showInformationMessage('No changes to undo for this run.');
      return;
    }
    for (const [relPath, origText] of rolledBack.entries()) {
      const absPath = deps.root + '/' + relPath;
      await deps.writeText(absPath, origText);
    }
    vscode.window.showInformationMessage(`Reverted ${rolledBack.size} file(s) from run.`);
  }

  // Register VS Code Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('groundwork.newTask', async () => {
      await vscode.commands.executeCommand('groundwork.panel.focus');
    }),

    vscode.commands.registerCommand('groundwork.inlineEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Please select a region of code for inline edit.');
        return;
      }

      const instruction = await vscode.window.showInputBox({
        prompt: 'Enter instructions for selected code',
        placeHolder: 'e.g. Treat "off" and "n" as false as well, case-insensitively...',
      });
      if (!instruction) return;

      const doc = editor.document;
      const relPath = vscode.workspace.asRelativePath(doc.uri);
      const startLine = editor.selection.start.line + 1;
      const endLine = editor.selection.end.line + 1;
      const selected = doc.getText(editor.selection);

      const prompt = buildInlinePrompt(relPath, startLine, endLine, selected, instruction);
      currentRunId = `inline-${Date.now()}`;
      mcpInstance?.setRunId(currentRunId);

      const handlers = await createTurnHandlers();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Groundwork: Applying inline edit...',
          cancellable: true,
        },
        async (_, progressToken) => {
          progressToken.onCancellationRequested(async () => {
            await stopCurrentTask();
          });

          await runWithFallback(
            models,
            async (modelName) => {
              const spec = loadAgentSpec('groundwork-inline', modelName);
              const sessId = await client.startSession({ spec });
              currentSessionId = sessId;
              return await client.runTurn(sessId, prompt, handlers);
            },
            (notice) => {
              vscode.window.showWarningMessage(notice);
            }
          );
        }
      );
    }),

    vscode.commands.registerCommand('groundwork.stop', stopCurrentTask),
    vscode.commands.registerCommand('groundwork.undoRun', undoLastRun),

    vscode.commands.registerCommand('groundwork.selectModel', async () => {
      const picked = await vscode.window.showQuickPick(models, {
        placeHolder: 'Select primary model (others remain as fallback)',
      });
      if (picked) {
        models = [picked, ...models.filter((m) => m !== picked)];
        vscode.window.showInformationMessage(`Primary model set to: ${picked}`);
      }
    }),

    vscode.commands.registerCommand('groundwork.showSession', async () => {
      if (!currentSessionId) {
        vscode.window.showInformationMessage('No active TrueForge session yet.');
        return;
      }
      await vscode.env.clipboard.writeText(currentSessionId);
      vscode.window.showInformationMessage(`Copied session ID (${currentSessionId}) to clipboard.`);
      vscode.env.openExternal(vscode.Uri.parse(trueforgeUrl));
    }),

    vscode.commands.registerCommand('groundwork.ping', async () => {
      try {
        const spec = loadAgentSpec('Forge-ops');
        vscode.window.showInformationMessage(`TrueForge Agent Spec Loaded: ${spec.model?.name}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Ping failed: ${err.message}`);
      }
    })
  );
}

export function deactivate() {
  mcpInstance?.close();
}
