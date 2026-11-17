# Groundwork (Round 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **For the human team:** each task names an owner (P1/P2/P3). Work your own column in §Schedule; tasks only depend on the **Interfaces** blocks of other tasks, so you can build in parallel against them.

**Goal:** A VS Code extension, acting as a client of a local TrueForge agent, that completes the three fixed Flask 3.1.3 tasks (inline edit, 3-file agent change, model-failure resilience) with per-hunk review, evidence-based retrieval, clean cancellation and automatic fallback.

**Architecture:** TrueForge runs the loop and calls the model. The extension hosts an HTTP MCP server (the agent's tools), drives sessions/turns through `@truefoundry/trueforge-sdk`, and turns `tool.approval_required` events for `edit_file` into per-hunk review in the editor. A statistician subagent ranks files using BM25, git co-change and import links, all computed locally by MCP tools.

**Tech Stack:** TypeScript, VS Code Extension API, esbuild (CJS bundle), vitest, `@truefoundry/trueforge-sdk`, `@modelcontextprotocol/sdk`, `diff` (jsdiff), Node `child_process`.

**Spec:** `docs/superpowers/specs/2026-11-17-groundwork-design.md` (same content as `forgeathon-round1-plan.md`)

## Global Constraints

- The extension never calls a model provider directly; every model call goes through TrueForge, inline edit included.
- Editor capabilities are exposed as MCP tools; the agent decides what to read and change.
- TrueForge runs in local mode: `OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' npx @truefoundry/trueforge@<pinned>` at `http://localhost:8790`.
- No API keys or secrets in the repo; ship `config/models.example.yaml` and `config/trueforge.env.example`.
- Nothing is written to disk without the user accepting it; an applied change is undoable.
- Agent definitions committed in `agent/`. Main agent `groundwork-main`, inline agent `groundwork-inline`, MCP server name `groundwork-editor`.
- Approval-gated tools: exactly `["edit_file", "run_command"]`.
- Limits: `read_file` ≤ 300 lines/call; `search` ≤ 50 hits; `run_command` output tail ≤ 4096 bytes, default timeout 120 s; `list_files` ≤ 200; repo map ≤ 3000 tokens; ranking ≤ 8 files; context budget 25 000 tokens; token estimate = `ceil(chars / 4)`.
- Ranking: BM25 k1 = 1.2, b = 0.75; final = 0.6·bm25 + 0.25·cochange + 0.15·imports; skip commits touching > 30 files; git log window 3000 commits.
- Fallback: one retry after 1500 ms for transient errors only; first-event timeout 20 s; auth/network errors go straight to the next model.
- Inline edit keybinding `ctrl+alt+k` (`cmd+alt+k` on mac).
- Target: feature freeze **18 Nov 01:00 IST**, submit **18 Nov 21:00 IST**. Official hard limit stays 20 Nov 23:59 (buffer).
- Don't copy code from other participants' repos. Borrowed upstream code (Cline/Continue) is declared with URL + commit, and its licence is preserved.

## Review Focus

1. **File open with unsaved edits in the editor:** `edit_file` must diff against the live buffer, not the disk copy, or the user's typing gets clobbered. → Task 7 reads through `ToolDeps.readText`, backed by `workspace.openTextDocument`; manual check step.
2. **Agent repeats an identical `edit_file` call:** a decision must be used once; a second call with no fresh review must be refused, never silently written. → Task 6 test `takeDecision_is_single_use`.
3. **CRLF files with an LF `old_string`:** must still match, and the file must keep CRLF. → Task 5 test `applyReplace_handles_crlf`.
4. **Model gives absolute or `..` paths, or Windows separators:** inside-workspace absolute paths are accepted, anything escaping the workspace is rejected. → Task 2 tests `resolveInWorkspace_*`.
5. **User presses Stop while a hunk review is open:** the review closes, its decorations clear, the pending approval resolves as deny, and nothing is written. → Task 7 test `cancelAll_resolves_pending_as_deny`.

---

## File map

```
groundwork/
  agent/groundwork-main.json, groundwork-inline.json          (T9)
  config/models.example.yaml, trueforge.env.example           (T1)
  scripts/register-agents.ts, smoke.ts                        (T1, T9)
  docs/verified-api.md                                        (T1)
  extension/
    package.json, tsconfig.json, esbuild.mjs, vitest.config.ts (T0)
    src/types.ts                                              (T0)  shared types
    src/extension.ts                                          (T0→ grows) activation wiring
    src/mcp/guards.ts, server.ts, register.ts                 (T2)
    src/mcp/tools/readTools.ts                                (T2)  read_file, list_files, search
    src/mcp/tools/editTool.ts                                 (T7)  edit_file
    src/mcp/tools/runCommand.ts                               (T8)
    src/mcp/tools/statsTools.ts                               (T13) repo_map, rank_files, co_change, find_symbol
    src/trueforge/router.ts, client.ts                        (T3)
    src/trueforge/fallback.ts                                 (T14)
    src/edits/apply.ts                                        (T5)  pure diff logic
    src/edits/store.ts                                        (T6)  staged edits, decisions, checkpoints
    src/edits/review.ts                                       (T7)  decorations + CodeLens
    src/stats/tokenize.ts, chunk.ts, bm25.ts                  (T11)
    src/stats/cochange.ts, imports.ts                         (T12)
    src/stats/rank.ts, repoMap.ts, service.ts                 (T13)
    src/context/budget.ts, mentions.ts                        (T15)
    src/inline/inlineEdit.ts                                  (T10)
    src/panel/AgentPanel.ts, media/panel.html, panel.js, panel.css (T4)
    test/**/*.test.ts, test/fixtures/*.json
```

---

### Task 0: Repo scaffold (owner P2, all three pull it) · 17 Nov, 1 h

**Files:**
- Create: `extension/package.json`, `tsconfig.json`, `esbuild.mjs`, `vitest.config.ts`, `src/extension.ts`, `src/types.ts`, `test/smoke.test.ts`, root `.gitignore`, `LICENSE` (MIT), `README.md` stub

**Interfaces:**
- Produces `src/types.ts`:
```ts
export interface Hunk { id: string; oldStart: number; oldLines: string[]; newLines: string[] } // id "h0","h1",… in file order
export interface ProposedEdit { key: string; path: string; before: string; after: string; hunks: Hunk[] }
export type StageResult = { ok: true; edit: ProposedEdit } | { ok: false; reason: 'not_found' | 'ambiguous' };
export interface RankedFile { path: string; score: number; evidence: string }
export interface CommandResult { exitCode: number | null; output: string; timedOut: boolean }
export interface ApprovalRequest { threadId: string; toolCallId: string; toolName: string; args: Record<string, unknown> }
export type ApprovalDecision = { status: 'allow' } | { status: 'deny'; reason: string };
export interface TurnResult { status: 'completed' | 'error' | 'cancelled'; message?: string; sessionId: string }
export interface TurnHandlers {
  onText(delta: string): void;
  onToolCall(name: string, args: unknown, threadId: string): void;
  onToolResult(name: string, summary: string, threadId: string): void;
  onThread(kind: 'created' | 'done', threadId: string, status?: string): void;
  onApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}
```
- Produces npm scripts: `build` (esbuild → `dist/extension.js`, CJS, `external: ['vscode']`), `watch`, `test` (vitest run).

- [ ] **Step 1:** `package.json` contributes: view container `groundwork` + webview view `groundwork.panel`; commands `groundwork.newTask`, `groundwork.inlineEdit`, `groundwork.stop`, `groundwork.undoRun`, `groundwork.selectModel`, `groundwork.showSession`, `groundwork.ping`; keybinding `ctrl+alt+k`/`cmd+alt+k` → `groundwork.inlineEdit` when `editorHasSelection`; settings `groundwork.trueforgeUrl` (default `http://localhost:8790`), `groundwork.models` (string[]).
- [ ] **Step 2:** write `test/smoke.test.ts` asserting `1 + 1 === 2`; run `npm test` → PASS.
- [ ] **Step 3:** `npm run build` → `dist/extension.js` exists; press F5 → Extension Development Host shows the Groundwork view.
- [ ] **Step 4:** `.gitignore` includes `node_modules`, `dist`, `.env`, `*.key`, `config/models.yaml`. Commit `chore: scaffold extension`.

---

### Task 1: TrueForge environment + API verification (owner P1) · 17 Nov, 2–3 h

**Files:**
- Create: `config/models.example.yaml`, `config/trueforge.env.example`, `scripts/smoke.ts`, `docs/verified-api.md`, `extension/test/fixtures/stream-basic.json`, `extension/test/fixtures/stream-approval.json`

**Interfaces:**
- Produces `docs/verified-api.md`, which answers the spec's §19 items: the exact MCP registration request body; the `turn.done` success status string; the field path for tool name + args in the event referenced by `source_event_id`; whether an approval resumes the same turn (`subscribeToTurn`) or starts a new one; the model catalog YAML for both chosen models.
- Produces the two fixture files: raw event arrays captured from real runs (one plain reply; one gated tool call). Task 3 tests read them.

- [ ] **Step 1:** pin the TrueForge version (note it in the README). Start it with `OUTBOUND_URL_ALLOWED_HOSTS`, configure the primary + fallback models, and confirm both answer in the TrueForge chat UI.
- [ ] **Step 2:** `git clone https://github.com/pallets/flask && git checkout 3.1.3` (full history); venv; `pip install -e . pytest`; `pytest tests/test_cli.py -q` → passes on unmodified Flask.
- [ ] **Step 3:** `scripts/smoke.ts` creates a session with an inline `agent.spec` (primary model, no tools), streams "Say hi", and dumps all events to `stream-basic.json`. Run `npx tsx scripts/smoke.ts` → prints the reply.
- [ ] **Step 4:** register any MCP test tool marked as write (or use T2's server once it exists), trigger an approval, and dump the events to `stream-approval.json`. Fill in `verified-api.md`.
- [ ] **Step 5:** commit `chore: trueforge setup, api notes, fixtures`. **Tell P2 and P3 about every difference from the spec's §3.1.**

---

### Task 2: MCP server, path guards, read tools, registration (owner P2) · 17 Nov

**Files:**
- Create: `src/mcp/guards.ts`, `src/mcp/server.ts`, `src/mcp/register.ts`, `src/mcp/tools/readTools.ts`
- Test: `test/mcp/guards.test.ts`, `test/mcp/readTools.test.ts`

**Interfaces:**
- Produces `resolveInWorkspace(root: string, p: string): string` (absolute normalized path; throws `Error('path outside workspace')`).
- Produces
```ts
export interface ToolDeps {
  root: string;
  readText(absPath: string): Promise<string>;               // live buffer if open, else disk
  listFiles(glob: string, max: number): Promise<string[]>;  // workspace-relative
  store: import('../edits/store').EditStore;                // T6
  writeText(absPath: string, text: string): Promise<void>;  // WorkspaceEdit + save (T7)
  runCommand(cmd: string, timeoutS: number, signal: AbortSignal): Promise<CommandResult>; // T8
  stats: import('../stats/service').StatsService;           // T13
}
startMcpServer(deps: ToolDeps): Promise<{ url: string; token: string; close(): Promise<void> }>
registerMcpServer(baseUrl: string, name: 'groundwork-editor', url: string, token: string): Promise<void>
```
- Tool schemas (MCP `inputSchema`): `read_file{path, start_line?, end_line?}`, `list_files{glob}`, `search{query, glob?, regex?}`, plus later tasks' tools. Read tools carry `annotations: { readOnlyHint: true }`; `edit_file` and `run_command` carry `readOnlyHint: false, destructiveHint: true`.
- `read_file` returns lines prefixed `"<n>: "`, at most 300; past that, a final line `"… truncated, use start_line/end_line"`.

- [ ] **Step 1: failing tests**
```ts
test('resolveInWorkspace_rejects_escape', () => expect(() => resolveInWorkspace('/ws', '../etc/passwd')).toThrow('path outside workspace'));
test('resolveInWorkspace_accepts_absolute_inside', () => expect(resolveInWorkspace('/ws', '/ws/src/a.py')).toBe('/ws/src/a.py'));
test('resolveInWorkspace_normalizes_backslashes', () => expect(resolveInWorkspace('/ws', 'src\\flask\\cli.py')).toBe('/ws/src/flask/cli.py'));
test('read_file_caps_300_lines', async () => { /* readText returns 1000 lines → result has 301 lines, last starts with "… truncated" */ });
test('search_caps_50_hits', async () => { /* 80 matching lines across fake files → 50 results, each "path:line: snippet" */ });
```
- [ ] **Step 2:** `npm test` → FAIL (not defined).
- [ ] **Step 3:** implement. The server uses `@modelcontextprotocol/sdk` Streamable HTTP on `127.0.0.1:0` (random port) with bearer-token check. `search` runs over `listFiles('**/*', …)` contents, skipping `.git`, `node_modules`, `.venv`. Registration uses the request shape recorded in `docs/verified-api.md`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5 (walking skeleton):** `groundwork.ping` creates a session with `groundwork-editor` attached (inline spec, no approvals) and sends `"Read README.rst and tell me its first heading."`. Expected in the Output channel "Groundwork": a `read_file README.rst` tool call, then text containing "Flask".
- [ ] **Step 6:** commit `feat(mcp): server, guards, read tools, registration`.

---

### Task 3: TrueForge client and event router (owner P2) · 17–18 Nov

**Files:**
- Create: `src/trueforge/router.ts`, `src/trueforge/client.ts`
- Test: `test/trueforge/router.test.ts` (uses T1 fixtures)

**Interfaces:**
- Consumes: `TurnHandlers`, `ApprovalRequest`, `TurnResult` (T0); fixtures (T1).
- Produces
```ts
export function routeEvent(index: Map<string, any>, ev: any, h: TurnHandlers):
  { approvals?: ApprovalRequest[]; done?: Omit<TurnResult, 'sessionId'> };
export type AgentRef = { name: string } | { spec: unknown };
export class ForgeClient {
  constructor(baseUrl: string);
  startSession(agent: AgentRef): Promise<string>;
  runTurn(sessionId: string, input: string, h: TurnHandlers, firstEventTimeoutMs?: number): Promise<TurnResult>;
  cancel(sessionId: string): Promise<void>;
}
```
- `runTurn` behaviour: merges deltas (`isEventDelta`/`mergeEventDelta`); on approvals, awaits `h.onApproval` for each, sends the `user.tool_approval` events, and continues as `docs/verified-api.md` says (same turn via `subscribeToTurn`, or new turn); resubscribes from the last event id if the stream ends before `turn.done`; resolves `{status:'error', message:'no response from model within 20s'}` when no event arrives within `firstEventTimeoutMs` (default 20000); maps any non-error, non-cancelled done status to `'completed'`.

- [ ] **Step 1: failing tests**
```ts
test('routes_text_deltas_in_order', () => { /* replay stream-basic.json → onText calls join to the final reply text */ });
test('routes_approval_with_tool_name_and_args', () => { /* replay stream-approval.json → approvals[0].toolName === the gated tool, args deep-equals the call's args, threadId set */ });
test('routes_done_error_message', () => { /* synthetic turn.done {state:{status:'error', message:'401'}} → done = {status:'error', message:'401'} */ });
test('routes_subagent_thread_events', () => { /* thread.created/thread.done → onThread('created'|'done', id, status) */ });
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement `routeEvent` (pure) and `ForgeClient` (SDK calls from the spec's §3.1).
- [ ] **Step 4:** run → PASS. Manual check: the `groundwork.ping` output streams token by token.
- [ ] **Step 5:** commit `feat(trueforge): client, event router`.

---

### Task 4: Agent panel webview (owner P2) · 18 Nov

**Files:**
- Create: `src/panel/AgentPanel.ts`, `media/panel.html`, `media/panel.js`, `media/panel.css`

**Interfaces:**
- Consumes: `ForgeClient`, `TurnHandlers`.
- Produces panel messages (extension → webview): `{type:'text', delta}`, `{type:'tool', name, detail, threadId}`, `{type:'thread', kind, threadId, status?}`, `{type:'approval', id, title, body}`, `{type:'banner', level:'info'|'warn'|'error', text}`, `{type:'meter', used, budget, files}`, `{type:'done', status}`. Webview → extension: `{type:'send', text}`, `{type:'stop'}`, `{type:'approve', id, allow}`, `{type:'undoRun'}`.
- Produces `AgentPanel.post(msg)` for other tasks to use.

- [ ] **Step 1:** implement. Batch `text` deltas into one `postMessage` every 40 ms; tool rows are collapsible; subagent threads are indented under a "Statistician" header; Stop is enabled only while a turn runs.
- [ ] **Step 1b:** `groundwork.showSession` opens the TrueForge chat UI (`vscode.env.openExternal(groundwork.trueforgeUrl)`) and copies the current session id to the clipboard, so the video can jump straight to the Task B session.
- [ ] **Step 2 (manual verify):** send "List the files in src/flask" → text streams smoothly, a `list_files` row appears, and typing in the editor stays responsive during the turn.
- [ ] **Step 3:** commit `feat(panel): streaming agent panel`.

---

### Task 5: Pure edit logic (owner P3) · 17 Nov

**Files:**
- Create: `src/edits/apply.ts`
- Test: `test/edits/apply.test.ts`

**Interfaces:**
- Produces
```ts
applyReplace(text: string, oldStr: string, newStr: string):
  { ok: true; text: string } | { ok: false; reason: 'not_found' | 'ambiguous' };
computeHunks(before: string, after: string): Hunk[];
applySelectedHunks(before: string, after: string, acceptedIds: string[]): string;
```

- [ ] **Step 1: failing tests**
```ts
test('applyReplace_basic', () => expect(applyReplace('a\nb\n', 'b', 'c')).toEqual({ ok: true, text: 'a\nc\n' }));
test('applyReplace_not_found', () => expect(applyReplace('a\n', 'zz', 'c')).toEqual({ ok: false, reason: 'not_found' }));
test('applyReplace_ambiguous', () => expect(applyReplace('x\nx\n', 'x', 'y')).toEqual({ ok: false, reason: 'ambiguous' }));
test('applyReplace_handles_crlf', () => expect(applyReplace('a\r\nb\r\n', 'a\nb', 'a\nc')).toEqual({ ok: true, text: 'a\r\nc\r\n' }));
test('computeHunks_two_regions', () => {
  const h = computeHunks('a\nb\nc\nd\n', 'a\nB\nc\nD\n');
  expect(h.map(x => x.id)).toEqual(['h0', 'h1']);
  expect(h[0]).toMatchObject({ oldStart: 2, oldLines: ['b'], newLines: ['B'] });
});
test('applySelectedHunks_partial', () => expect(applySelectedHunks('a\nb\nc\nd\n', 'a\nB\nc\nD\n', ['h0'])).toBe('a\nB\nc\nd\n'));
test('applySelectedHunks_none_is_identity', () => expect(applySelectedHunks('a\nb\n', 'a\nc\n', [])).toBe('a\nb\n'));
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement. CRLF: if the text contains `\r\n`, convert `oldStr`/`newStr` to CRLF before matching. Hunks: `diffLines(before, after)` from jsdiff; walk the parts and group each run of consecutive removed/added parts into one hunk (ids in order); `oldStart` is the 1-based line where the run starts in `before`. `applySelectedHunks` re-walks the same grouping, emitting `newLines` for accepted hunks and `oldLines` otherwise, with unchanged parts copied through.
- [ ] **Step 4:** run → PASS. Commit `feat(edits): replace + hunk logic`.

---

### Task 6: Edit store (owner P3) · 18 Nov AM

**Files:**
- Create: `src/edits/store.ts`
- Test: `test/edits/store.test.ts`

**Interfaces:**
- Consumes: `applyReplace`, `computeHunks`, `applySelectedHunks` (T5).
- Produces
```ts
export function editKey(path: string, oldStr: string, newStr: string): string; // sha1 hex of path+'\0'+old+'\0'+new
export class EditStore {
  stage(path: string, currentText: string, oldStr: string, newStr: string): StageResult;
  decide(key: string, acceptedIds: string[]): void;
  takeDecision(key: string): { edit: ProposedEdit; acceptedIds: string[] } | undefined; // single use
  recordCheckpoint(runId: string, path: string, originalText: string): void; // first record per path wins
  undoRun(runId: string): Map<string, string>;  // path → original text
  touchedIn(runId: string): string[];
  discardPending(): void;                       // drops staged + undecided, keeps checkpoints
}
```

- [ ] **Step 1: failing tests**
```ts
test('stage_not_found', () => expect(new EditStore().stage('a.py', 'x\n', 'zz', 'y')).toEqual({ ok: false, reason: 'not_found' }));
test('stage_then_decide_then_take', () => { /* stage ok → decide(key,['h0']) → takeDecision(key).acceptedIds = ['h0'] */ });
test('takeDecision_is_single_use', () => { /* second takeDecision(key) → undefined */ });
test('checkpoint_first_wins_and_undo', () => { /* record r1 a.py 'v1', then 'v2' → undoRun('r1').get('a.py') === 'v1' */ });
test('discardPending_clears_undecided', () => { /* stage, discardPending, takeDecision → undefined */ });
```
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(edits): edit store with decisions and checkpoints`.

---

### Task 7: Review UI + `edit_file` tool + approval wiring (owner P3, with P2 for wiring) · 18 Nov

**Files:**
- Create: `src/edits/review.ts`, `src/mcp/tools/editTool.ts`
- Modify: `src/extension.ts` (connect `TurnHandlers.onApproval` → review)
- Test: `test/edits/review.test.ts` (logic only, vscode mocked), `test/mcp/editTool.test.ts`

**Interfaces:**
- Consumes: `EditStore` (T6), `ToolDeps` (T2), `ApprovalRequest/Decision` (T0), `AgentPanel.post` (T4).
- Produces
```ts
export class ReviewController {
  review(edit: ProposedEdit): Promise<string[] | 'cancelled'>; // accepted hunk ids
  cancelAll(): void;                                           // resolves every pending review with 'cancelled', clears decorations
}
export async function onEditApproval(req: ApprovalRequest, deps: ToolDeps, review: ReviewController): Promise<ApprovalDecision>;
export async function editFileTool(args: { path: string; old_string: string; new_string: string }, deps: ToolDeps, runId: string): Promise<string>;
```
- `onEditApproval`: reads `deps.readText` → `store.stage`. On not found/ambiguous → `{deny, reason:'old_string not_found|ambiguous in <path>; re-read the file with read_file'}` (no UI). Otherwise opens the file and calls `review`. `'cancelled'` or `[]` → deny with `'user rejected all hunks'`; else `store.decide` → allow.
- `editFileTool`: `takeDecision(editKey(...))`. Missing → returns `'refused: edit was not reviewed'` and writes nothing. Else `recordCheckpoint`, `writeText(path, applySelectedHunks(before, after, ids))`, returns `'Applied K of N hunks to <path>; rejected: h2'`.
- UI: added lines get a green background decoration; removed lines are shown as a red "ghost" `after` decoration on the line above; a CodeLens above each hunk shows `✓ Accept` / `✗ Reject`; panel buttons for Accept all / Reject all. The review resolves once every hunk is decided.

- [ ] **Step 1: failing tests**
```ts
test('cancelAll_resolves_pending_as_deny', async () => { /* review() pending → cancelAll() → resolves 'cancelled'; onEditApproval returns {status:'deny'} */ });
test('auto_deny_when_old_string_missing', async () => { /* readText 'a\n', args old 'zz' → deny reason contains 'not_found', review never called */ });
test('editFileTool_refuses_unreviewed', async () => { /* no decision → returns 'refused: edit was not reviewed', writeText not called */ });
test('editFileTool_applies_only_accepted', async () => { /* decision ['h0'] on two-hunk edit → writeText called with partial text; result 'Applied 1 of 2 hunks …' */ });
```
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5 (manual verify):** in the panel, ask "In src/flask/helpers.py change the docstring of get_debug_flag to say 'Hello'". The pause shows hunks; reject → the file is unchanged and the agent says it was rejected; repeat and accept → the file changes and Ctrl+Z reverts it. Then repeat with the file open **and an unsaved edit elsewhere in it** → that unsaved edit survives.
- [ ] **Step 6:** commit `feat(review): per-hunk review driven by TrueForge approvals`.

---

### Task 8: `run_command` tool (owner P2) · 18 Nov

**Files:**
- Create: `src/mcp/tools/runCommand.ts`
- Test: `test/mcp/runCommand.test.ts`

**Interfaces:**
- Produces `runCommand(cmd: string, cwd: string, timeoutS: number, signal: AbortSignal): Promise<CommandResult>`, used as `ToolDeps.runCommand`. The tool returns `"exit <code>\n<output>"`. Approval for it goes through the panel `approval` message (allow/deny) in `extension.ts`.

- [ ] **Step 1: failing tests**
```ts
test('captures_exit_code', async () => expect((await runCommand('node -e "process.exit(3)"', tmp, 10, new AbortController().signal)).exitCode).toBe(3));
test('tails_output_to_4096_bytes', async () => { /* print 10000 chars → output.length <= 4096 and ends with the last chars */ });
test('times_out', async () => { /* node -e "setTimeout(()=>{},5000)" with timeoutS 1 → timedOut true */ });
test('abort_kills', async () => { /* abort after 100ms → resolves quickly, exitCode null */ });
```
- [ ] **Step 2:** run → FAIL. **Step 3:** implement with `spawn(cmd, {shell:true, cwd})`; kill the process tree on timeout/abort. **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(mcp): run_command with timeout, tail, abort`.

---

### Task 9: Agent definitions + registration script (owner P1) · 18 Nov AM

**Files:**
- Create: `agent/groundwork-main.json`, `agent/groundwork-inline.json`, `scripts/register-agents.ts`

**Interfaces:**
- Produces two saved agents exactly as the spec's §4.1 and §4.3 (manifest + instructions verbatim from §4.1.1), with the model names from `docs/verified-api.md`.
- Produces `loadAgentSpec(name: 'groundwork-main' | 'groundwork-inline', model?: string): unknown`, exported from `scripts/register-agents.ts` and copied into `extension/src/trueforge/specs.ts`. It returns the manifest with `model.name` replaced, for T14 inline-spec sessions.

- [ ] **Step 1:** `npx tsx scripts/register-agents.ts` creates or updates both agents. Then `agents.list` prints them; check that `require_approval_for_tools`, `dynamic_sub_agents`, `compaction` and `large_tool_response` **survived** (unknown keys are silently dropped).
- [ ] **Step 2 (verify):** in the TrueForge chat UI, run `groundwork-main` with "What does get_debug_flag do?" → it calls `repo_map`/`search` (stub them until T13 if needed) and answers.
- [ ] **Step 3:** commit `feat(agent): main + inline agent definitions`.

---

### Task 10: Inline edit command, Task A end to end (owner P3) · 18 Nov PM

**Files:**
- Create: `src/inline/inlineEdit.ts`
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `ForgeClient` (T3), `ReviewController`/`onEditApproval` (T7), agent `groundwork-inline` (T9).
- Produces `buildInlinePrompt(relPath: string, startLine: number, endLine: number, selected: string, instruction: string): string`, which returns:
```
File: <relPath>
Lines: <startLine>-<endLine>
Selected code:
<selected>
Instruction: <instruction>
```

- [ ] **Step 1:** test `buildInlinePrompt` output for a sample → PASS after implementing.
- [ ] **Step 2:** the command runs `showInputBox`, then `startSession({name:'groundwork-inline'})`, then `runTurn` with progress in the status bar (cancellable → `client.cancel`).
- [ ] **Step 3 (verify Task A):** in Flask, select `get_debug_flag`, press `ctrl+alt+k`, and enter the exact instruction: *Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.* Hunks appear; accept all; run `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` → `False`. Reset with `git checkout -- .`.
- [ ] **Step 4:** commit `feat(inline): inline edit via groundwork-inline`.

---

### Task 11: Tokenizer, chunker, BM25 (owner P1) · 18 Nov

**Files:**
- Create: `src/stats/tokenize.ts`, `src/stats/chunk.ts`, `src/stats/bm25.ts`
- Test: `test/stats/bm25.test.ts`

**Interfaces:**
- Produces
```ts
tokenize(text: string): string[];   // split non-alphanumerics, snake_case, camelCase; lowercase; drop length < 2
interface Chunk { path: string; startLine: number; endLine: number; text: string }
chunkFile(path: string, text: string): Chunk[]; // .py: one chunk per top-level def/class + one for module preamble; .rst/.md: per heading; else one chunk per 80 lines
class Bm25Index { constructor(chunks: Chunk[], k1?: number, b?: number); scoreFiles(query: string): Map<string, { score: number; hits: number }> }
// file score = max chunk score + 0.5 * mean(top-3 chunk scores); hits = query-token occurrences in the file
```

- [ ] **Step 1: failing tests**
```ts
test('tokenize_snake_and_camel', () => expect(tokenize('get_debug_flag FlaskGroup')).toEqual(['get', 'debug', 'flag', 'flask', 'group']));
test('chunk_python_by_def', () => { /* 'import x\n\ndef a():\n  pass\n\nclass B:\n  pass\n' → 3 chunks, startLines [1,3,6] */ });
test('bm25_ranks_relevant_file_first', () => {
  const idx = new Bm25Index([...chunkFile('cli.py', 'def routes_command():\n  """Show routes command"""'), ...chunkFile('helpers.py', 'def get_debug_flag():\n  pass')]);
  const s = idx.scoreFiles('cli command');
  expect(s.get('cli.py')!.score).toBeGreaterThan(s.get('helpers.py')?.score ?? 0);
});
```
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS → **Step 5:** commit `feat(stats): tokenizer, chunker, bm25`.

---

### Task 12: Co-change and import graph (owner P1) · 18–19 Nov

**Files:**
- Create: `src/stats/cochange.ts`, `src/stats/imports.ts`
- Test: `test/stats/cochange.test.ts`, `test/stats/imports.test.ts`

**Interfaces:**
- Produces
```ts
parseGitLog(raw: string, maxFilesPerCommit?: number): string[][]; // input from: git log --name-only --pretty=format:%H -n 3000
coChange(commits: string[][], path: string): Map<string, number>;  // P(other changes | path changes), 0..1
buildImportGraph(files: Map<string, string>, packageRoots: string[]): Map<string, Set<string>>; // undirected; resolves 'from flask.x import' and 'from .x import' to repo paths
```

- [ ] **Step 1: failing tests**
```ts
test('cochange_probabilities', () => {
  const m = coChange([['a', 'b'], ['a', 'b'], ['a', 'c']], 'a');
  expect(m.get('b')).toBeCloseTo(0.667, 2); expect(m.get('c')).toBeCloseTo(0.333, 2);
});
test('parseGitLog_skips_mass_commits', () => { /* one commit with 31 files + one with 2 → returns 1 commit */ });
test('imports_resolve_relative_and_absolute', () => {
  const g = buildImportGraph(new Map([['src/flask/cli.py', 'from .helpers import get_debug_flag\nfrom flask.config import Config'], ['src/flask/helpers.py', ''], ['src/flask/config.py', '']]), ['src']);
  expect([...g.get('src/flask/cli.py')!].sort()).toEqual(['src/flask/config.py', 'src/flask/helpers.py']);
});
```
- [ ] **Step 2:** FAIL → **Step 3:** implement (git log read once through `runCommand` with cwd = workspace root) → **Step 4:** PASS → **Step 5:** commit `feat(stats): co-change and import graph`.

---

### Task 13: Ranking, repo map, stats tools, statistician visible (owner P1; panel rendering P2) · 19 Nov AM

**Files:**
- Create: `src/stats/rank.ts`, `src/stats/repoMap.ts`, `src/stats/service.ts`, `src/mcp/tools/statsTools.ts`
- Test: `test/stats/rank.test.ts`

**Interfaces:**
- Consumes: T11, T12, `ToolDeps`.
- Produces
```ts
rankFiles(query: string, bm25: Map<string, {score: number; hits: number}>, commits: string[][], imports: Map<string, Set<string>>, k: number): RankedFile[];
buildRepoMap(files: Map<string, string>, maxTokens: number): string; // tree + top-level def/class names, trimmed to fit
class StatsService { constructor(deps: Pick<ToolDeps,'root'|'listFiles'|'readText'|'runCommand'>); ready(): Promise<void>; rank(query: string, k?: number): Promise<RankedFile[]>; coChange(path: string, k?: number): Promise<Array<{path: string; pct: number}>>; repoMap(): Promise<string>; findSymbol(name: string): Promise<string[]> }
```
- Ranking algorithm: normalise BM25 by the max (0..1); take the top-3 BM25 files T; cochange(f) = max over t∈T of coChange(t).get(f); imports(f) = 1 if f is adjacent to any t∈T, else 0; final = 0.6·bm25 + 0.25·cochange + 0.15·imports; sort descending, round to 2 dp, take k (max 8). Evidence = the non-empty parts joined by `"; "`: `"<hits> keyword hits"`, `"changed with <t> in <pct>% of commits"` (best t), `"imports/imported by <t>"`.
- Tools: `repo_map{}`, `rank_files{query, k?}` (returns a markdown table `| path | score | evidence |`), `co_change{path, k?}`, `find_symbol{name}` (regex `^\s*(def|class)\s+<name>\b`, returns `path:line`).

- [ ] **Step 1: failing tests**
```ts
test('rank_combines_signals', () => { /* bm25 {cli:1, test_cli:0.2, docs:0.1}, commits make test_cli co-change 0.7 with cli → test_cli ranks 2nd, evidence contains 'changed with cli' and '70%' */ });
test('rank_caps_at_k_and_8', () => { /* 20 files, k=20 → length 8 */ });
test('repoMap_respects_budget', () => { /* 500 files → estimateTokens(map) <= 3000 */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5 (verify):** in the panel, send the Task B instruction. The TrueForge session shows a subagent thread calling `rank_files`; the panel shows the ranking under "Statistician" and the agent's "Context plan". `src/flask/cli.py`, `tests/test_cli.py` and `docs/cli.rst` appear in the top 5. If not, tune the query wording in the main prompt's step 2, not the weights.
- [ ] **Step 6:** commit `feat(stats): ranking, repo map, statistician tools`.

---

### Task 14: Fallback and resilience, Task C (owner P2) · 19 Nov

**Files:**
- Create: `src/trueforge/fallback.ts`
- Modify: `src/extension.ts` (wrap panel + inline runs)
- Test: `test/trueforge/fallback.test.ts`

**Interfaces:**
- Produces
```ts
classifyError(message: string): 'auth' | 'network' | 'transient' | 'other';
// auth: /401|403|invalid.*key|unauthori[sz]ed|api key/i ; network: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|unreachable|no response from model/i ; transient: /429|5\d\d|timeout|overloaded|rate limit/i
runWithFallback(models: string[], attempt: (model: string) => Promise<TurnResult>, notify: (text: string) => void, sleep?: (ms: number) => Promise<void>): Promise<TurnResult & { model: string }>;
```
- Rules: `completed`/`cancelled` → return immediately. `error`: `transient` → retry the same model once after 1500 ms; `auth`/`network`/`other` → next model at once. Before each switch, `notify("<Primary> failed (<short reason>). Switched to fallback <model>.")`, and the caller runs `store.discardPending()` + `review.cancelAll()`. All models failed → return the last error; the caller shows the error banner `"All configured models failed: <reason>. No files were changed."`.
- Each attempt starts a new session via `{ spec: loadAgentSpec(agentName, model) }`.
- `groundwork.selectModel`: a QuickPick over `groundwork.models` that moves the chosen model to the front of the list (primary); the next task uses it. The panel header shows the active model.
- `ToolDeps.runCommand` is T8's `runCommand` with `cwd` bound to the workspace root.

- [ ] **Step 1: failing tests**
```ts
test('auth_error_falls_back_without_retry', async () => { /* attempt(m1)→error '401 invalid api key', attempt(m2)→completed → result.model==='m2', attempt called 2×, notify called once */ });
test('transient_retries_once_then_falls_back', async () => { /* m1 → '503' twice → m2 called; sleep called with 1500 */ });
test('all_fail_returns_last_error', async () => { /* both error → status 'error' */ });
test('cancelled_is_not_retried', async () => { /* m1 cancelled → attempt called 1× */ });
```
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5 (verify Task C):** set an invalid key for the primary in TrueForge → repeat Task A → warning banner names the switch → the diff appears from the fallback → `git status` clean → reject. Then make **both** models invalid → error banner, editor responsive, `git status` clean.
- [ ] **Step 6:** commit `feat(resilience): automatic model fallback`.

---

### Task 15: Cancel cleanup, Undo run, context meter, @mentions (owner P3) · 19 Nov

**Files:**
- Create: `src/context/budget.ts`, `src/context/mentions.ts`
- Modify: `src/extension.ts`, `src/panel/*`
- Test: `test/context/budget.test.ts`, `test/context/mentions.test.ts`

**Interfaces:**
- Produces
```ts
estimateTokens(text: string): number;  // Math.ceil(text.length / 4)
class ContextMeter { constructor(budget = 25000); add(path: string | null, text: string): void; snapshot(): { used: number; budget: number; files: number }; reset(): void }
parseMentions(input: string): { files: string[]; symbols: string[]; rest: string }; // '@src/a.py' → files; '@#get_debug_flag' → symbols
```
- Stop: `client.cancel(sessionId)` → wait for the terminal `turn.done` → `review.cancelAll()` → `store.discardPending()` → abort the running command → toast `"Cancelled. No pending changes were written."`. If `store.touchedIn(runId)` is non-empty, offer **Keep** / **Revert run** (Revert = `undoRun` + `writeText` per file).
- Undo run button: same as Revert, for the last finished run.
- The meter adds every `read_file`/`search`/`rank_files`/`repo_map` result and any mention payloads, and posts `{type:'meter'}` after each tool result.
- Mentions: `@file` autocomplete from `listFiles('**/*.{py,rst,md,toml}', 200)`; `@#symbol` resolved by `stats.findSymbol`. Resolved content is prepended to the user message as `"Pinned context:\n<path>:\n<content>"` (capped by `read_file` limits).

- [ ] **Step 1: failing tests**
```ts
test('estimateTokens', () => expect(estimateTokens('abcdefgh')).toBe(2));
test('meter_counts_distinct_files', () => { /* add('a',x), add('a',y), add('b',z) → files 2 */ });
test('parseMentions', () => expect(parseMentions('fix @src/a.py and @#run_command now')).toEqual({ files: ['src/a.py'], symbols: ['run_command'], rest: 'fix and now' }));
```
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5 (verify):** start Task B, press Stop while text streams → toast, `git status` clean, no decorations. Start again, accept the first file's hunks, then Stop → Keep/Revert prompt; Revert → `git status` clean. Finish a run → Undo run → clean.
- [ ] **Step 6:** commit `feat(ux): cancel cleanup, undo run, context meter, mentions`.

---

### Task 16: Task B tuning on both models (owner P1) · 19 Nov PM, until freeze

**Files:**
- Modify: `agent/groundwork-main.json` (instructions only), re-run `register-agents`

- [ ] **Step 1:** run Task B with the exact instruction: *Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "\*\*\*". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.* Accept all, then verify:
```bash
pytest tests/test_cli.py -q                  # passes
printf 'from flask import Flask\napp = Flask(__name__)\napp.config.update(SECRET_KEY="s", API_TOKEN="t", DB_PASSWORD="p")\n' > /tmp/demo_app.py
flask --app /tmp/demo_app config             # JSON with "***" for SECRET_KEY, API_TOKEN, DB_PASSWORD; no crash on timedelta values
flask --app /tmp/demo_app --help             # lists "config"
git diff --stat                              # ≥ 3 files
```
- [ ] **Step 2:** repeat until it passes **3 times in a row on the primary and once on the fallback**. Fix failures by editing the instructions (for example, adding "JSON-serialise non-JSON values with default=str" to the step-6 test guidance), never Flask-specific hard-coding in the tools. Log each change in `docs/prompt-log.md` (useful for the write-up).
- [ ] **Step 3:** commit `chore(agent): tune main prompt for multi-file tasks`.

---

### Task 17: README, video, write-up, submission (owner P3 lead, all help) · 20 Nov

**Files:**
- Modify: `README.md`; Create: `docs/writeup.md` → `writeup.pdf`, `THIRD_PARTY_NOTICES.md` (if any code was borrowed)

- [ ] **Step 1 (P2, morning):** on a second laptop, follow the README from a fresh clone through Tasks A–C. Fix every step that fails. Run a secret scan (`git log -p | grep -iE "sk-|api[_-]?key|bearer"`) → nothing. Make the repo public.
- [ ] **Step 2 (P3):** record per the spec's §14 script (A → B → C → cancellation, ≤ 4:00, no cut between instruction and diff, TrueForge session shown during B). Upload as unlisted.
- [ ] **Step 3 (P3 + P1):** write the PDF with the 8 headings in order (spec §15). Fill the scorecard with **real timestamps** from the uploaded video. Declare models, where they ran, cost, and AI tools used. Write an honest limitations section (fallback is extension-orchestrated; BM25 has no synonym handling; Python-only symbol index).
- [ ] **Step 4 (all):** open the video, PDF and repo links in an incognito window → all load. Submit on the Techfest portal **by 21:00 IST**.

---

## Schedule (IST): compressed, build everything tonight (Tue 17 Nov)

| Slot | P1 (agent & retrieval) | P2 (extension core) | P3 (editor UX & delivery) |
|---|---|---|---|
| 15:00–17:00 | T1 (setup, API checks, fixtures) → T9 | T0 → T2 (walking skeleton by 17:00) | T5 → T6 |
| 17:00–20:00 | T11 → T12 | T3 → T4 | T7 |
| 20:00–20:30 | **Sync: merge to `main`, run the walking skeleton together** | | |
| 20:30–23:00 | T13 | T8 → T14 | T10 (**Task A ✅ by 22:00**) → T15 |
| 23:00–01:00 | T16 (Task B tuning) | integration fixes, **Task C ✅** | T15 finish, rehearse A |
| **01:00** | **Feature freeze.** Full A → B → C run-through ×2; bug fixes only | | |
| Wed 18, day | write-up help | T17 step 1 (clean clone, repo public) | T17 steps 2–4 (video, write-up) |
| **Wed 18, 21:00** | **Submit** (2 days early; ties break on earlier submission) | | |

**Checkpoints (decide cuts here, not later):**
- **17:00:** no walking skeleton → all three swarm on T2/T3 before anything else.
- **22:00:** Task A not working → cut `@#symbol`, the context meter and the imports signal.
- **01:00:** Task B not passing reliably → main agent calls `rank_files` directly (drop the subagent spawn); keep BM25 + co-change.
- Thu 19 / Fri 20 remain as buffer for anything unfinished. Don't spend it on new features.

**Cut order if late:** imports signal (T12 part) → `@#symbol` (T15) → context meter polish → co-change (keep BM25). **Never cut:** T7, T14, T15 Stop cleanup, TrueForge session shot.
