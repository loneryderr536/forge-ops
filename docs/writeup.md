# Groundwork: TrueForge Coding Agent Extension — Round 1 Technical Report

## 1. Team
- Groundwork Team (Team Size: 3)
- Focus: Editor-native agent integration, evidence-based retrieval, diff safety, and multi-model resilience.

## 2. Starting Point
- Built clean from scratch.
- Pure TypeScript implementation of the extension host, HTTP MCP tool server, Myers line differ, Git co-change indexer, BM25 ranker, and TrueForge SSE client.
- No code was borrowed from other participants' repositories. Upstream reference designs (Cline/Continue) informed the UI design and CodeLens hunk decoration patterns.

## 3. Architecture on TrueForge
The architecture strictly enforces separation of concerns:
- **TrueForge Core**: TrueForge runs locally on port 8790, driving the central model loop, conversation compaction, dynamic subagent threads, and tool authorization barriers.
- **Client SDK & Event Router**: The extension communicates exclusively with TrueForge through SSE streaming, decomposing turns into streaming message deltas, subagent thread transitions, and approval gates.
- **Embedded MCP Server**: Runs directly inside the extension on `127.0.0.1:<port>/mcp`, gated by a cryptographically random bearer token per window.
- **Per-Hunk Approval Workflow**:
  1. `tool.approval_required` arrives from TrueForge for `edit_file`.
  2. The extension computes structured hunks against the live editor buffer.
  3. If target text is missing or ambiguous, Groundwork auto-denies without troubling the developer.
  4. The editor displays inline diff decorations and CodeLens controls (`✓ Accept | ✗ Reject`).
  5. Only approved hunks are applied to disk as atomic workspace edits.

## 4. How Context Is Selected: The Statistician Subagent
Rather than consuming thousands of tokens reading full files or relying on black-box embeddings, Groundwork employs a deterministic statistician subagent:
- **BM25 Relevance (Weight: 0.6)**: Chunks code by top-level declarations (functions/classes in Python, sections in markdown/rst) with parameters $k_1 = 1.2$, $b = 0.75$.
- **Git Co-Change History (Weight: 0.25)**: Evaluates $P(B \mid A) = \frac{\text{commits}(A \wedge B)}{\text{commits}(A)}$ over the last 3000 commits, automatically filtering mass refactors (>30 files).
- **Import Graph Proximity (Weight: 0.15)**: Statically parses relative and absolute Python imports to locate structural neighbors.
- **Context Meter**: Real-time tracking against a strict 25,000 token budget (`ceil(chars / 4)`).

## 5. Model Setup & Resilience
- Configured with free and open-source models:
  - **Google Gemini** (`google-gemini/gemini-3-5-flash`): Primary high-speed reasoning model utilizing the free tier via Google AI Studio.
  - **Groq Cloud** (`groq/qwen3-8-27b` & `groq/qwen3-8-27b`): Free tier inference for fallback and fast inline edits.
  - **Local Ollama** (`ollama/qwen2-5-coder-7b`): 100% offline, local, and free via OpenAI-compatible endpoint (`http://localhost:11434/v1`).
- API credentials reside strictly in TrueForge's runtime environment, never in workspace files.
- Automatic fallback: transient errors (5xx, 429, timeout) trigger one 1.5s retry before transparently switching to the fallback model. Authentication or connection failures switch immediately. Workspace state is preserved clean throughout.

## 6. Scorecard

| Criterion | Video Timestamp | Verified Claim |
|---|---|---|
| A1 Inline edit | 0:12 | Selection-targeted prompt with in-place per-hunk review |
| A2 Agent mode | 1:00 | Found and edited 3 files unprompted on Task B |
| A3 Streaming / cancel | 3:35 | Token streaming and instant Stop leaving workspace clean |
| B1 Context (Statistician) | 1:10 | Ranked relevant files with computed evidence table |
| B2 Diff safety | 0:50 / 2:20 | Per-hunk review, no silent disk writes, full checkpoint Undo |
| B3 Resilience | 2:55 | Fallback on invalid primary key with clean `git status` |
| B4 TrueForge depth | 2:40 | Streamable HTTP MCP tools, approvals, and subagent threads |
| C1 Video | — | Complete end-to-end video verification |
| C2 Write-up | — | Comprehensive architecture & verification writeup |

## 7. Tools Used
- VS Code Extension API
- TrueForge local agent engine (`@truefoundry/trueforge-sdk` protocol)
- Model Context Protocol (MCP) Streamable HTTP
- Node.js native test runner & TypeScript

## 8. Known Limitations & Roadmap
- **Synonym Search**: BM25 relies on lexical matching; incorporating lightweight local embeddings as a secondary signal would improve recall for conceptual queries.
- **Language Support**: AST and import analysis are currently optimized for Python, RST, and Markdown. Future iterations will add Tree-sitter parsers for TypeScript and Rust.
- **Native TrueForge Fallback**: Fallback orchestration is currently managed by the client extension; contributing native multi-provider fallback to TrueForge core is planned for future work.
