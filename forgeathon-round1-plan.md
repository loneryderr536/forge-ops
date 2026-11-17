# TrueForge Forge-a-thon — Round 1 Plan & Agent Draft

**Team size:** 3 · **Deadline:** 20 Nov 2026, 23:59 IST (target submit by 21:00) · **Status:** draft for team approval

> Working product name: **Groundwork** (rename freely). Tagline: *"A coding agent that shows its work — it finds the right code with evidence, and nothing touches your files until you approve it."*

---

## 0. TL;DR

We build a VS Code extension that is a **client** of a local TrueForge agent. TrueForge runs the loop and calls the model. Our extension provides:

1. **The agent definitions** (system prompts + manifests): a main coding agent, a statistician subagent, and a small inline-edit agent.
2. **An MCP tool server inside the extension**: the agent's hands (read, search, rank, edit, run).
3. **The editor UI**: agent panel, inline edit, per-hunk diff review, undo, Stop, error/fallback banners.

The thing that sets us apart is the **statistician subagent**. Before editing, it ranks the repository's files with computed evidence: keyword relevance (BM25), git co-change frequency and import links. The agent then shows *which files it chose and why, with numbers*. That targets the 15-point context criterion (B1) and the subagent requirement in B4.

---

## 1. Positioning (business value)

**Who it's for:** engineers working in large or unfamiliar codebases where a wrong edit is expensive, and companies that care about cost, code privacy and not being locked into one model vendor.

**Persona (for video intro and write-up):** a backend engineer maintaining a 200k-line Python service. She's asked to add an admin command, which touches the CLI, tests and docs. Current tools make her name every file, or rewrite things she didn't ask for.

| Pain (from the problem statement) | Our feature | Value |
|---|---|---|
| Loses track of the file you care about | Statistician ranking + "files I chose and why" | Works beyond the context window; faster onboarding |
| Rewrites code you didn't ask it to touch | Per-hunk review, no silent writes, undo | Trust; less review time |
| Edits a symbol that doesn't exist | Search-and-replace edits are auto-rejected if the target text isn't found | No hallucinated edits reach disk |
| You must name every file | Agent mode finds files itself | Cross-cutting chores in one request |
| Provider outages / cost | Automatic fallback, works with any model | Keeps working; can run cheap or local |
| "What did the AI do?" | Every step recorded in the TrueForge session | Auditable |

**Rule:** business value earns no direct Round 1 points. Use it only as a README tagline, the first ~10 seconds of the video, and as the *reason* behind design decisions in the write-up.

---

## 2. Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Fork Cline/Roo Code** and replace its loop | Polished UI, but ripping out a deeply wired loop + provider layer takes days | ❌ Too slow for ~3.5 days |
| **B. From scratch, borrowing small pieces** (diff renderer, search helper) from Cline/Continue | We control the architecture; less UI polish | ✅ **Chosen** |
| **C. A separate "verifier" subagent** to check accuracy | Adds model calls and cost; an AI judging an AI is unreliable on weak models | ❌ Dropped. The main agent runs `pytest` instead |
| **D. Statistician as the retrieval subagent** | Cheap computed evidence; model-agnostic; visible in Task B | ✅ **Chosen** |

If we borrow any upstream code: declare the upstream URL + commit in the README, keep its LICENSE and attribution, and list what we changed.

> ⚠️ **Do not copy code from other participants' public repos** (for example other "TrueForge VS Code extension" repos on GitHub). Rule 12 disqualifies every team involved. Upstream projects like Cline/Continue are fine.

---

## 3. Architecture

```
┌──────────────────────── VS Code (extension host) ────────────────────────┐
│  Agent panel (webview)   Inline edit cmd   Diff review (decorations+CodeLens)│
│            │                    │                     ▲                    │
│            ▼                    ▼                     │                    │
│     TrueForge client (SDK) ── event router ──► Pending-edit store          │
│            │  ▲                                       ▲                    │
│            │  │ SSE events                            │                    │
│  MCP tool server (HTTP, 127.0.0.1:<port>/mcp) ◄───────┘ (applies accepted) │
└────────────│──▲──────────────────────────────────────▲─────────────────────┘
             │  │ sessions / turns / approvals          │ MCP tool calls
             ▼  │                                       │
      ┌──────────────── TrueForge (local, :8790) ───────┴──┐
      │ agent loop · sessions · approvals · subagents ·    │──► Model (primary)
      │ compaction · streaming                             │──► Model (fallback)
      └────────────────────────────────────────────────────┘
```

**Eligibility rules we satisfy (pass/fail):**
- The extension only talks to TrueForge (SDK `@truefoundry/trueforge-sdk`), never to a model provider. This includes inline edit.
- Editor capabilities are MCP tools; the agent decides what to read and change.
- TrueForge runs in local mode (`npx @truefoundry/trueforge@latest`).
- Models are configured in TrueForge (catalog provider or OpenAI-compatible endpoint).
- Agent definitions are committed in `agent/`.

### 3.1 TrueForge facts we rely on (verified from docs)

- **Client:** `new TrueForge({ baseUrl: 'http://localhost:8790', timeoutInSeconds: 600 })`
- **Session:** `client.sessions.create({ agent: { name } })`, or pass an inline spec under `agent.spec` (nothing is saved). We use the inline spec to swap models for fallback.
- **Turn:** `client.sessions.createTurnStream(sessionId, { input: [{ type: 'user.message', content }] })`. The stream starts with `turn.created` and ends with `turn.done`.
- **Events:** `turn.created`, `turn.update`, `turn.done`, `model.message`, `model.message.delta`, `tool.response`, `tool.approval_required`, `thread.created`, `thread.done`, `mcp.*`. Merge deltas with `isEventDelta` / `mergeEventDelta`.
- **Approvals:** `tool.approval_required` lists `tool_calls: [{ id, source_event_id }]`. Look up `source_event_id` to get the tool name and args. The turn pauses. Then:
  1. `subscribeToTurn(sessionId, turnId, { afterEventId })`
  2. `createTurnEvents(sessionId, turnId, { events: [{ type: 'user.tool_approval', threadId, toolCallId, approval: { status: 'allow' | 'deny', reason? } }] })`
  3. Read the subscription until `turn.done` or the next pause.
- **Cancel:** `client.sessions.cancel(sessionId)`. Idempotent, works whether running or paused, and emits a terminal `turn.done`, so don't break out of the loop early.
- **Errors:** `turn.done` with `state.status: "error"` includes a `message`. `thread.done` with error = failed subagent (the root turn continues). The SDK does **not** reconnect on its own; resubscribe from the last event id.
- **Manifest:** `model.name` (`provider/model`), `model.params`, `instructions`, `mcp_servers[]` (`name`, `enable_tools`, `require_approval_for_tools`, `preload`), `config` (`iteration_limit`, `dynamic_sub_agents.enabled`, `context_management.compaction.enabled`, `context_management.large_tool_response.enabled`, `sandbox.enabled`). **Unknown keys are silently dropped**, so check the saved agent after creating it.
- **Not documented: native model fallback.** We implement fallback in the extension by retrying the turn on a second TrueForge-configured model (see §8).

### 3.2 Gotchas to handle on Day 1

- TrueForge must be allowed to call our localhost MCP server. Start it with `OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]'`.
- Register our MCP server with TrueForge via the settings API (`PUT /api/v1/settings/mcp-servers`, `type: "remote"`, `url`, header auth with a bearer token). **Verify the exact body against the TrueForge docs / OpenAPI.**
- The SDK is ESM. Bundle the extension with **esbuild** into CommonJS; plain `tsc` output may fail to load it.
- **Pin the TrueForge version** in the README (for example `npx @truefoundry/trueforge@<version>`) so a clean clone behaves like our demo.
- Clone Flask with **full git history** (not `--depth 1`), or the co-change statistics will be empty.

---

## 4. Agent definitions (draft)

Files live in `agent/`. A script `scripts/register-agents.ts` creates or updates them through `client.agents.create/update`.

### 4.1 Main agent: `groundwork-main`

```jsonc
// agent/groundwork-main.json  (body for client.agents.create)
{
  "name": "groundwork-main",
  "description": "Editor-native coding agent: evidence-based retrieval, reviewed multi-file edits, tests.",
  "manifest": {
    "model": { "name": "<provider>/<primary-model>", "params": { "temperature": 0.2, "max_tokens": 4096 } },
    "instructions": "<<see 4.1.1>>",
    "mcp_servers": [
      {
        "name": "groundwork-editor",
        "enable_tools": ["@all"],
        "require_approval_for_tools": ["edit_file", "run_command"],
        "preload": true
      }
    ],
    "config": {
      "iteration_limit": 60,
      "sandbox": { "enabled": false },
      "dynamic_sub_agents": { "enabled": true },
      "context_management": {
        "compaction": { "enabled": true },
        "large_tool_response": { "enabled": true }
      }
    }
  }
}
```

Why `preload: true`: we only have ~9 tools, and weaker models struggle with the meta-tools used for deferred loading. Our B4 context-engineering features are **subagents + compaction + large-tool-response offloading**.

#### 4.1.1 Main agent instructions (system prompt)

```text
You are Groundwork, a careful coding agent working inside the user's VS Code workspace.
You can only see and change code through your tools. The user reviews every edit.

WORKFLOW — follow in order:
1. ORIENT: call repo_map once to see the project layout.
2. LOCATE: spawn a subagent named "statistician" with this task:
   "Rank the files most relevant to: <the user's request>. Use rank_files and
   co_change. Return at most 8 files as a table: path | score | evidence (one line)."
   Do not read whole files before you have the ranking.
3. CONTEXT PLAN: before any edit, write a short section titled "Context plan" listing
   the files you will read or change, each with its score and the reason, and the
   files you are deliberately ignoring. Keep total code read under ~25k tokens:
   read line ranges with read_file, not whole large files.
4. VERIFY SYMBOLS: before editing a function, class or variable, confirm it exists
   with find_symbol or search. Never edit code you have not read in this session.
5. EDIT: use edit_file with small, exact old_string/new_string replacements.
   One logical change per call. Change only what the request needs; keep the
   existing style; do not reformat unrelated code.
6. TEST: if tests exist for the changed area, add or update a test, then run the
   narrowest test command with run_command (e.g. "pytest tests/test_cli.py -q").
   If tests fail, fix and re-run at most 2 times, then stop and report.
7. REPORT: finish with a short summary: files changed, why, test result, anything
   left undone.

RULES:
- If an edit is denied, read the reason, do not retry the same edit; adjust or ask.
- If a tool result says old_string was not found, re-read the file before retrying.
- If you cannot complete the task, say so clearly and stop. Do not guess.
- Be concise in chat. No long explanations of code the user can see in the diff.
```

### 4.2 Statistician subagent

TrueForge creates subagents dynamically (`dynamic_sub_agents`); the main agent spawns it with the task text from step 2. Subagents cannot spawn subagents or ask the user questions. Its behaviour is fixed by the tool descriptions and the task text above. Its output appears as its own thread in the TrueForge session, which is **what we show in the video for B1/B4**.

If the dynamic-subagent spawn turns out to be unreliable on our model, the **fallback** is for the main agent to call `rank_files` directly. We lose some B4 credit, but B1 is unaffected.

### 4.3 Inline-edit agent: `groundwork-inline`

```jsonc
{
  "name": "groundwork-inline",
  "description": "Edits only the user's selected region.",
  "manifest": {
    "model": { "name": "<provider>/<primary-model>", "params": { "temperature": 0.1, "max_tokens": 2048 } },
    "instructions": "You edit ONLY the selected region of one file. The user message gives the file path, line range, the selected code and an instruction. Make the change with one or a few edit_file calls whose old_string lies inside the selection. Update docstrings/comments in the selection if the instruction asks. Do not touch other code. Do not run commands. Reply with one sentence describing the change.",
    "mcp_servers": [
      { "name": "groundwork-editor", "enable_tools": ["read_file", "edit_file"],
        "require_approval_for_tools": ["edit_file"], "preload": true }
    ],
    "config": { "iteration_limit": 6, "dynamic_sub_agents": { "enabled": false } }
  }
}
```

---

## 5. MCP tools (the agent's hands)

Served by the extension at `http://127.0.0.1:<port>/mcp` (Streamable HTTP, `@modelcontextprotocol/sdk`), with a random bearer token per window. Read tools carry the `readOnlyHint` annotation.

| Tool | Args | Returns | Approval |
|---|---|---|---|
| `repo_map` | – | File tree + top-level `def`/`class` names per file, trimmed to ~3k tokens | no |
| `list_files` | `glob` | Matching paths (max 200) | no |
| `read_file` | `path, start_line?, end_line?` | Numbered lines, max 300 per call. **Returns the staged version if there are pending edits** | no |
| `search` | `query, glob?, regex?` | `path:line: snippet`, max 50 hits | no |
| `find_symbol` | `name` | Definition locations (VS Code symbol provider, regex index as backup) | no |
| `rank_files` | `query, k?` | Ranked table: path, score, evidence (statistician) | no |
| `co_change` | `path, k?` | Files that most often change with `path` in git history, with % | no |
| `edit_file` | `path, old_string, new_string` | "Applied N of M hunks; rejected: …" | **yes** |
| `run_command` | `cmd, timeout_s?` | Exit code + last ~4 KB of output | **yes** |

**Guardrails:** paths must stay inside the workspace. `edit_file` fails if `old_string` occurs 0 or more than 1 times (the error message tells the agent to re-read the file). `run_command` has a default 120 s timeout and is killed on Stop.

---

## 6. Context strategy (B1, 15 pts): the statistician

### 6.1 Signals

1. **BM25 keyword relevance** over code chunks. Chunk Python by top-level `def`/`class`, chunk `.rst`/`.md` by headings. Tokenize identifiers by splitting snake_case and camelCase. Use k1=1.2, b=0.75. File score = max chunk score + 0.5 × mean of its top-3 chunks.
2. **Git co-change:** parse `git log --name-only --pretty=format:%H -n 3000` once at startup. Then P(B changes | A changes) = commits(A∧B) / commits(A). Skip commits touching more than 30 files (mass refactors).
3. **Import links:** parse `import` / `from … import` lines to build a graph. Neighbours of high-scoring files get a boost.

**Final score** = 0.6 × BM25 (normalised 0–1) + 0.25 × max co-change with the top-3 BM25 files + 0.15 × import proximity. Every row carries a one-line evidence string, for example *"23 keyword hits; changed with cli.py in 71% of commits"*.

Build the index lazily on first use and cache it in memory. It takes milliseconds on Flask (~17k lines).

### 6.2 Budget

- Repo map: ≤ 3k tokens.
- Ranking: ≤ 8 files.
- Code read by the main agent: ≤ ~25k tokens (prompt rule, plus line-range reads).
- Each tool response is capped (300 lines, 50 hits, 4 KB of command output).
- TrueForge compaction summarises older turns; large-tool-response offloading handles anything big.
- **The panel shows a live meter**: `Context: 14.2k / 25k tokens · 5 files`. The extension estimates it from tool-result sizes (chars ÷ 4).

### 6.3 What Task B should look like on screen

```
Statistician ranking for "add flask config CLI command…"
1. src/flask/cli.py      0.91  23 keyword hits; defines run/shell/routes commands
2. tests/test_cli.py     0.84  changed with cli.py in 71% of commits
3. docs/cli.rst          0.62  changed with cli.py in 38% of commits
4. src/flask/config.py   0.55  defines Config; imported by cli.py
Context plan: edit 1–3, read 4 (lines 1–120) for Config shape; ignoring app.py, …
```

(The numbers above are illustrative; the real ones come from running the tool.)

---

## 7. Diff review, undo and cancellation (A1, A3, B2, B4)

### 7.1 Approval → per-hunk review

1. `tool.approval_required` arrives. The extension looks up the tool call's name and args.
2. **edit_file:** apply `old_string → new_string` to the current (staged) file text.
   - Not found or ambiguous → **auto-deny** with the reason *"old_string not found; re-read the file"* (this is the hallucination guard; the user isn't bothered).
   - Otherwise compute hunks with jsdiff `structuredPatch`, render them in the editor (green/red decorations), and add a CodeLens per hunk: `✓ Accept | ✗ Reject`. The panel also has *Accept all / Reject all*.
3. The user decides:
   - **All rejected** → `deny` with reason *"user rejected all hunks"*.
   - **Some or all accepted** → store `decisions[hash(path, old, new)] = acceptedHunkIds`, then `allow`.
4. TrueForge runs `edit_file` → our MCP handler looks up the decision, applies **only the accepted hunks** as one `WorkspaceEdit`, saves, records a checkpoint, and returns *"Applied 2 of 3 hunks; hunk 3 rejected by user."* If no decision is found it refuses (it never writes unreviewed).
5. **run_command:** show the command in the panel with Allow / Deny.

Because the approval comes from TrueForge, this satisfies B4's *"TrueForge tool approval driving the diff review"*.

### 7.2 Undo

- Every apply goes through `workspace.applyEdit`, so **Ctrl+Z works** in the editor.
- Per-run checkpoints (the original text of each touched file) power an **"Undo this run"** button that restores all files at once. Show this on screen for B2's 10 points.

### 7.3 Streaming and cancellation

- Batch `model.message.delta` updates to the webview every ~40 ms. Everything is async, with no blocking file I/O on the UI path.
- **Stop:** `sessions.cancel()` → wait for the terminal `turn.done` → discard staged, unaccepted hunks and clear decorations → kill any child process → show a toast: *"Cancelled. No pending changes were written."* If accepted hunks were already applied this run, offer **Keep / Revert run**.
- In the video: cancel mid-run, then show `git status` clean.

---

## 8. Model setup and resilience (B3, Task C)

- Configure **two models in TrueForge**, ideally from different providers (for example a hosted API as primary, and a second provider or a local OpenAI-compatible server as fallback). Keys live in TrueForge's environment, **never in the repo**. Ship `config/models.example.*`.
- Extension settings: `groundwork.models = ["<provider>/<primary>", "<provider>/<fallback>"]`, `groundwork.trueforgeUrl`.
- **Fallback logic (in the extension, still entirely through TrueForge):**
  1. A turn ends with `state.status: "error"`, or there's no first event within 20 s.
  2. If it's transient (5xx/429/timeout): one retry after 1.5 s. Auth or connection errors skip the retry.
  3. Discard anything staged by the failed run. Banner: *"Primary model failed (401 invalid key). Switched to fallback <model>."*
  4. Create a new session with the same manifest via `agent.spec`, swapping `model.name` to the fallback, and resend the same input.
  5. If the fallback also fails: clear error, nothing changed, editor responsive.
- **Task C demo:** break the primary key → run Task A → banner shows the switch → the diff appears (staged in memory only) → run `git status` (clean) → reject. That shows "fallback with no user action, workspace unchanged."
- **Write-up honesty:** state that fallback is orchestrated by the extension choosing a second TrueForge-configured model, because local TrueForge doesn't document native fallback.

---

## 9. Extension UI

- **Sidebar panel:** chat, streamed reply, collapsible tool rows (`📄 read_file src/flask/cli.py:1-120`), the statistician table, context meter, Stop, model indicator, Undo run.
- **Inline edit:** `Ctrl+Alt+K` → input box → the `groundwork-inline` session → hunks appear in place.
- **`@file` / `@symbol`** autocomplete in the panel input. `@file` uses `workspace.findFiles`. `@symbol` uses `vscode.executeWorkspaceSymbolProvider`, with our regex index as backup. Mentioned items are added to the user message as pinned context (counted in the budget).
- **Commands:** `Groundwork: New Task`, `Inline Edit`, `Stop`, `Undo Last Run`, `Select Model`, `Show TrueForge Session` (opens the TrueForge chat UI for the current session).

---

## 10. Repository layout

```
groundwork/
  README.md                 # setup from clean clone, fork point, model config, demo steps
  LICENSE                   # ours (MIT/Apache-2.0) + upstream licences in licenses/ if borrowed
  THIRD_PARTY_NOTICES.md
  agent/
    groundwork-main.json
    groundwork-inline.json
  config/
    models.example.yaml     # example model catalog, no keys
    trueforge.env.example   # OUTBOUND_URL_ALLOWED_HOSTS, provider key names (empty)
  scripts/
    register-agents.ts      # create/update agents via SDK
  extension/
    package.json            # commands, keybindings, view, settings
    esbuild.mjs
    src/
      extension.ts
      trueforge/client.ts   # sessions, turns, event router, approvals, cancel, fallback
      mcp/server.ts         # HTTP MCP server + registration with TrueForge
      mcp/tools/*.ts        # repo_map, read_file, search, find_symbol, edit_file, run_command
      stats/bm25.ts, cochange.ts, imports.ts, rank.ts
      edits/store.ts        # staged edits, hunks, decisions, checkpoints, undo
      edits/render.ts       # decorations + CodeLens
      inline/inlineEdit.ts
      panel/AgentPanel.ts + media/
  docs/
    writeup.pdf             # final write-up (also linked separately)
```

`.gitignore`: `.env`, `*.key`, any real `models.yaml`. Run a secret scan before going public.

---

## 11. Team split

| Person | Owns | Done when |
|---|---|---|
| **P1: Agent & retrieval** | TrueForge setup, models + fallback config, agent manifests and prompts, `register-agents`, statistician (`bm25`, `cochange`, `imports`, `rank_files`), prompt tuning on Tasks A/B | Task B finds the 3 files and passes `pytest` 3 times out of 3 |
| **P2: Extension core** | Scaffold + esbuild, SDK client, event router, MCP server + registration, read/search/run tools, streaming panel, Stop/cancel, fallback logic | Panel streams, tools are called, cancel leaves things clean, fallback switches |
| **P3: Editor UX & delivery** | Edit store, hunks, decorations/CodeLens, apply/undo/checkpoints, inline edit command, `@` mentions, context meter. Later: video, write-up, README clean-clone test | Per-hunk accept/reject + undo on screen; video and write-up done |

**Interfaces to agree today (30 min):** the edit-store API (`stage`, `decide`, `applyAccepted`, `undoRun`, `discardPending`), the event-router callbacks, and the tool JSON shapes in §5.

---

## 12. Timeline (IST)

| When | Milestone | Owner |
|---|---|---|
| **Tue 17 Nov, PM** | Everyone runs TrueForge locally with one model; Flask cloned at `3.1.3` with full history; `pip install -e .` + pytest in a venv | all |
| Tue 17, night | **Walking skeleton:** panel message → TrueForge → agent calls our `read_file` → reply streams back | P2 (+P1) |
| **Wed 18 Nov** | All tools; edit_file + approval + basic diff view; inline edit; agent prompts v1; statistician v1 | P1/P2/P3 |
| Wed 18, EOD | ✅ **Task A works end to end** | – |
| **Thu 19 Nov** | Task B end to end; per-hunk CodeLens; undo run; Stop + cleanup; fallback; context meter | all |
| Thu 19, 20:00 | **Feature freeze.** Rehearse A/B/C 3× each; fix only bugs | all |
| **Fri 20 Nov, AM** | README clean-clone test on a second laptop; secret scan; repo public | P2 |
| Fri 20, PM | Record video (≤4 min); upload unlisted | P3 |
| Fri 20, evening | Write-up PDF with timestamp scorecard; check all links in an incognito window | P3 + P1 |
| **Fri 20, 21:00** | **Submit** (3 h buffer before 23:59) | all |

**If behind schedule, cut in this order:** import-graph signal → `@symbol` → context meter polish → co-change (keep BM25). **Never cut:** per-hunk review, cancel cleanliness, fallback, the TrueForge session shot.

---

## 13. Fixed-task runbook

**Setup (once):**
```bash
git clone https://github.com/pallets/flask && cd flask && git checkout 3.1.3   # full history
python -m venv .venv && source .venv/bin/activate && pip install -e . pytest
OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' npx @truefoundry/trueforge@<pinned>
```

**Task A (inline):** open `src/flask/helpers.py` → select `get_debug_flag` → `Ctrl+Alt+K` → paste the exact instruction → review hunks → accept → verify:
```bash
FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"   # False
```

**Task B (agent):** panel, no files mentioned, paste the exact instruction → statistician ranking + context plan visible → review hunks across ≥3 files → accept → verify:
```bash
pytest tests/test_cli.py -q
# demo app: app.py with SECRET_KEY, API_TOKEN, DB_PASSWORD set
flask --app app config     # masked JSON
flask --help               # shows "config"
```
Then show the TrueForge session (turns + tool calls + statistician thread). Watch out: Flask config contains non-JSON values (for example `PERMANENT_SESSION_LIFETIME` is a timedelta). Make sure the generated command handles them (`default=str`); the test should catch it.

**Task C (resilience):** set an invalid key for the primary → repeat Task A → fallback banner → diff appears → `git status` (clean) → reject.

**Reset between rehearsals:** `git checkout -- . && git clean -fd` in the Flask repo.

---

## 14. Video script (≤ 4:00, no cuts between instruction and diff)

| Time | Content | Criteria |
|---|---|---|
| 0:00–0:12 | Tagline + one-line persona | – |
| 0:12–1:00 | **Task A:** select, keybinding, instruction, streaming, per-hunk diff, accept one / show reject control, verify `False`; Ctrl+Z undo then redo | A1, B2 |
| 1:00–2:40 | **Task B:** instruction, statistician table + context plan, edits across 3 files, per-hunk review, `pytest` approval + pass, masked JSON, `flask --help`; **Undo run** shown briefly then redo/accept | A2, B1, B2 |
| 2:40–2:55 | TrueForge session: turns, tool calls, statistician thread | B4, eligibility |
| 2:55–3:35 | **Task C:** invalid key, Task A again, fallback banner, diff staged, `git status` clean | B3 |
| 3:35–3:55 | **Cancellation:** start a task, Stop mid-stream, "no pending changes written", `git status` clean | A3 |

Model waiting time may be cut, **except between giving an instruction and the diff appearing**. Fill those waits by showing streaming and tool rows. Use large fonts and zoom; captions are optional but help.

---

## 15. Write-up (PDF, 1–3 pages, these headings in this order)

1. **Team:** names, college/employer, GitHub handles.
2. **Starting point:** "from scratch" + any borrowed upstream code (URL + commit + what we changed).
3. **Architecture on TrueForge:** SDK client, event router, MCP tools list, approval-driven per-hunk review, subagents/compaction/large-tool-response and why.
4. **How context is selected:** statistician signals, formula, budget, what's excluded, why statistics over embeddings (no model calls, deterministic, any model).
5. **Model setup:** models, where they ran, approximate cost, how to switch, how fallback works (and that it's extension-orchestrated).
6. **Scorecard:**

| Criterion | Video timestamp | Claim |
|---|---|---|
| A1 Inline edit | 0:12 | Per-hunk accept/reject in editor |
| A2 Agent mode | 1:00 | Found and edited 3 files unprompted |
| A3 Streaming/cancel | 3:35 | Instant cancel, workspace clean |
| B1 Context | 1:10 | Ranked files with evidence and token budget |
| B2 Diff safety | 0:50 / 2:20 | Per-hunk review + undo run |
| B3 Resilience | 2:55 | Automatic fallback, `git status` clean |
| B4 TrueForge depth | 2:40 | MCP tools, approvals drive review, subagent + compaction |
| C1 Video | – | All three tasks verified on screen |
| C2 Write-up | – | This document |

(Fill in the real timestamps after recording.)

7. **Tools used:** VS Code, TrueForge, esbuild, jsdiff, MCP SDK, Claude (AI assistant). This costs no points.
8. **Known limitations + next month:** for example BM25 misses synonyms (next: embeddings as an extra signal), fallback lives in the extension (next: contribute native fallback to TrueForge, which could be a Round 2 PR), Python-only symbol index, no multi-root workspaces.

---

## 16. README checklist (must work from a clean clone)

- [ ] Prerequisites (Node, Python, pinned TrueForge version)
- [ ] Start TrueForge locally, including `OUTBOUND_URL_ALLOWED_HOSTS`
- [ ] Configure models (copy `config/models.example.*`, set keys in env)
- [ ] `npm install && npm run register-agents` (loads the agent definitions)
- [ ] Build/run the extension (F5 or `.vsix`)
- [ ] Clone Flask 3.1.3 (full history) + run the three tasks
- [ ] Fork point declaration (or "from scratch") + borrowed-code attributions
- [ ] No secrets committed

## 17. Submission checklist

- [ ] Video ≤ 4:00, public/unlisted, A → B → C order, each verified on screen
- [ ] Write-up PDF, 1–3 pages, exact 8 headings, real timestamps
- [ ] GitHub repo public, LICENSE present, agent definitions committed
- [ ] All three links opened in an incognito window before submitting
- [ ] Submitted on the Techfest portal by 21:00 IST, 20 Nov

---

## 18. Risks

| Risk | Mitigation |
|---|---|
| Model can't do Task B reliably | Use a capable model for recording; keep prompts model-agnostic; test on the fallback model too (organisers may rerun Task A live with their model) |
| Dynamic subagent misbehaves | Main agent calls `rank_files` directly (keeps B1) |
| Approval API differs from docs | Fallback: `edit_file` handler waits on a Promise resolved by the UI (loses part of B4) |
| TrueForge version changes | Pin the version |
| Free-tier rate limits during recording | Record early Friday; keep a paid fallback key with a small budget |
| Time | Feature freeze Thu 20:00; cut list in §12 |

---

## 19. Open items to verify on Day 1

- Exact MCP registration body and whether per-session tool scoping works for subagents.
- Whether `model.params` names are accepted by our chosen provider.
- The YAML model-catalog format for our providers (TrueForge docs, "Models" page).
- Whether `subscribeToTurn` + `createTurnEvents` resumes the same turn in our pinned version, or approvals start a new turn (another project reported the latter). Handle both.
