import * as fs from 'node:fs';
import * as path from 'node:path';

export function loadAgentSpec(name: 'Forge-ops' | 'forge-ops-inline', modelOverride?: string): any {
  // Check candidate paths for agent json
  const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const fileBaseName = name;
  const candidates = [
    path.resolve(currentDir, `../../../agent/${fileBaseName}.json`),
    path.resolve(currentDir, `../../agent/${fileBaseName}.json`),
    path.resolve(process.cwd(), `agent/${fileBaseName}.json`),
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      const parsed = JSON.parse(fs.readFileSync(cand, 'utf-8'));
      if (modelOverride && parsed.manifest && parsed.manifest.model) {
        parsed.manifest.model.name = modelOverride;
      }
      return parsed.manifest;
    }
  }

  // Fallback inline manifests if file not found
  if (name === 'forge-ops-inline') {
    return {
      model: { name: modelOverride || 'groq/qwen3-8-27b', params: { temperature: 0.1, max_tokens: 2048 } },
      instructions: 'You edit ONLY the selected region of one file. The user message gives the file path, line range, the selected code and an instruction. Make the change with one or a few edit_file calls whose old_string lies inside the selection. Update docstrings/comments in the selection if the instruction asks. Do not touch other code. Do not run commands. Reply with one sentence describing the change.',
      mcp_servers: [{ name: 'forge-ops-editor', enable_tools: ['read_file', 'edit_file'], require_approval_for_tools: ['edit_file'], preload: true }],
      config: { iteration_limit: 6, dynamic_sub_agents: { enabled: false } },
    };
  }

  return {
    model: { name: modelOverride || 'groq/qwen3-8-27b', params: { temperature: 0.2, max_tokens: 4096 } },
    instructions: 'You are Forge-ops, a careful coding agent working inside the user VS Code workspace.',
    mcp_servers: [{ name: 'forge-ops-editor', enable_tools: ['@all'], require_approval_for_tools: ['edit_file', 'run_command'], preload: true }],
    config: { iteration_limit: 60, dynamic_sub_agents: { enabled: true }, context_management: { compaction: { enabled: true }, large_tool_response: { enabled: true } } },
  };
}
