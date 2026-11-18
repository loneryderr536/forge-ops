import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { ToolDeps } from './tools/toolDeps';
import { readFileTool, listFilesTool, searchTool } from './tools/readTools';
import { editFileTool } from './tools/editTool';
import { runCommandTool } from './tools/runCommand';
import { repoMapTool, rankFilesTool, coChangeTool, findSymbolTool } from './tools/statsTools';

export interface McpServerInstance {
  url: string;
  token: string;
  setRunId(runId: string): void;
  close(): Promise<void>;
}

export function startMcpServer(deps: ToolDeps): Promise<McpServerInstance> {
  return new Promise((resolve, reject) => {
    const token = crypto.randomBytes(24).toString('hex');
    let currentRunId = 'default-run';

    const toolsManifest = [
      {
        name: 'repo_map',
        description: 'Get compact repository map with def/class symbols',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'list_files',
        description: 'List repository files matching a glob pattern (max 200)',
        inputSchema: {
          type: 'object',
          properties: { glob: { type: 'string', description: 'Glob pattern' } },
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'read_file',
        description: 'Read lines from a file with optional start_line and end_line (max 300 lines)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            start_line: { type: 'number' },
            end_line: { type: 'number' },
          },
          required: ['path'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'search',
        description: 'Search files for a query string or regex pattern (max 50 hits)',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            glob: { type: 'string' },
            regex: { type: 'boolean' },
          },
          required: ['query'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'find_symbol',
        description: 'Find function or class definitions matching a symbol name',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'rank_files',
        description: 'Statistician tool: rank files most relevant to a query using BM25, git co-change, and import links',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' }, k: { type: 'number' } },
          required: ['query'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'co_change',
        description: 'Statistician tool: get files that most often change with a file in git history',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, k: { type: 'number' } },
          required: ['path'],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'edit_file',
        description: 'Apply exact old_string -> new_string replacement to a file (requires user approval)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      {
        name: 'run_command',
        description: 'Run a shell command inside workspace (requires user approval)',
        inputSchema: {
          type: 'object',
          properties: { cmd: { type: 'string' }, timeout_s: { type: 'number' } },
          required: ['cmd'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
    ];

    const server = http.createServer(async (req, res) => {
      // Auth verification
      const authHeader = req.headers['authorization'];
      if (!authHeader || authHeader !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const jsonRpc = JSON.parse(body || '{}');
          const method = jsonRpc.method;
          const params = jsonRpc.params || {};
          const id = jsonRpc.id;

          let result: any = null;

          if (method === 'initialize') {
            result = {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'forge-ops-editor', version: '0.1.0' },
              capabilities: { tools: {} },
            };
          } else if (method === 'tools/list') {
            result = { tools: toolsManifest };
          } else if (method === 'tools/call') {
            const toolName = params.name;
            const args = params.arguments || {};
            let toolOutput = '';

            switch (toolName) {
              case 'repo_map':
                toolOutput = await repoMapTool(deps);
                break;
              case 'list_files':
                toolOutput = await listFilesTool(args, deps);
                break;
              case 'read_file':
                toolOutput = await readFileTool(args, deps);
                break;
              case 'search':
                toolOutput = await searchTool(args, deps);
                break;
              case 'find_symbol':
                toolOutput = await findSymbolTool(args, deps);
                break;
              case 'rank_files':
                toolOutput = await rankFilesTool(args, deps);
                break;
              case 'co_change':
                toolOutput = await coChangeTool(args, deps);
                break;
              case 'edit_file':
                toolOutput = await editFileTool(args, deps, currentRunId);
                break;
              case 'run_command':
                toolOutput = await runCommandTool(args, deps.root);
                break;
              default:
                throw new Error(`Unknown tool: ${toolName}`);
            }

            result = {
              content: [{ type: 'text', text: toolOutput }],
            };
          } else {
            result = {};
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
        } catch (err: any) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32603, message: err.message || 'Internal error' },
            })
          );
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      const url = `http://127.0.0.1:${address.port}/mcp`;
      resolve({
        url,
        token,
        setRunId(rId: string) {
          currentRunId = rId;
        },
        close(): Promise<void> {
          return new Promise((r) => server.close(() => r()));
        },
      });
    });

    server.on('error', reject);
  });
}
