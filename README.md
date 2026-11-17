# Groundwork

> *A coding agent that shows its work — it finds the right code with evidence, and nothing touches your files until you approve it.*

Groundwork is an editor-native coding extension for VS Code that operates as a client to a local TrueForge agent. TrueForge runs the core model loop, session state, and tool approvals, while Groundwork provides the editor UI, an embedded local MCP tool server, and an evidence-based statistician retrieval subagent.

---

## Key Features

1. **Evidence-Based Statistician Subagent**: Ranks workspace files before reading them using BM25 keyword relevance, Git co-change commit frequencies, and static import graphs.
2. **Approval-Driven Per-Hunk Diff Review**: TrueForge's `tool.approval_required` events drive in-editor hunk review with Accept/Reject controls. No unreviewed edits touch disk.
3. **Resilience & Automatic Fallback**: Seamlessly switches to a secondary configured model if the primary model encounters authentication, rate limit, or server errors, with zero workspace leakage.
4. **Instant Cancellation & Checkpoint Undo**: Stop cancels the active turn immediately, cleans up all in-memory staged hunks, and provides one-click checkpoint rollback (`Undo Run`).

---

## Architecture

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

---

## Quickstart & Setup

### 1. Prerequisites
- Node.js >= 20
- Python 3.10+
- Git

### 2. Configure TrueForge & Models
Copy the example environment and model configuration files:
```bash
cp config/trueforge.env.example config/trueforge.env
cp config/models.example.yaml config/models.yaml
```

Set your model provider API keys in `config/trueforge.env` or in your local shell:
```bash
export ANTHROPIC_API_KEY="your-anthropic-key"
export OPENAI_API_KEY="your-openai-key"
```

Start the local TrueForge instance:
```bash
OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' npx @truefoundry/trueforge@latest
```

### 3. Register Agent Definitions
Register the committed agent manifests (`groundwork-main` and `groundwork-inline`):
```bash
node --import ./scripts/register-loader.mjs scripts/register-agents.ts
```

### 4. Build and Run Extension
```bash
cd extension
npm run build
```
Open this workspace in VS Code and press `F5` to launch the Extension Development Host.

---

## Fixed-Task Runbook (Flask 3.1.3)

Clone Flask with full history to exercise Git co-change statistics:
```bash
git clone https://github.com/pallets/flask && cd flask && git checkout 3.1.3
python -m venv .venv && source .venv/bin/activate && pip install -e . pytest
```

### Task A (Inline Edit)
1. Open `src/flask/helpers.py` and select the `get_debug_flag` function.
2. Press `Ctrl+Alt+K` (`Cmd+Alt+K` on macOS).
3. Enter the instruction:
   > Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.
4. Review the hunks in the editor and click Accept.
5. Verify:
   ```bash
   FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())" # Outputs: False
   ```

### Task B (Multi-File Agent Task)
1. Open the Groundwork sidebar panel.
2. Enter the task instruction without naming files:
   > Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.
3. Watch the Statistician subagent rank `src/flask/cli.py`, `tests/test_cli.py`, and `docs/cli.rst`.
4. Review each hunk and approve `run_command` test execution.
5. Verify:
   ```bash
   pytest tests/test_cli.py -q
   ```

### Task C (Resilience & Fallback)
1. Invalidate your primary model key in TrueForge.
2. Re-run Task A.
3. Observe the panel banner: *"Primary model failed. Switched to fallback <model>"*.
4. Verify the staged diff appears, `git status` remains clean, and reject/cancel as desired.

---

## Running Tests
Run the complete unit and integration test suite:
```bash
node --import ./scripts/register-loader.mjs --test extension/test/smoke.test.ts extension/test/mcp/*.test.ts extension/test/edits/*.test.ts extension/test/stats/*.test.ts extension/test/trueforge/*.test.ts extension/test/context/*.test.ts
```
# forge-ops
