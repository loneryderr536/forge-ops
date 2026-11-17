import * as fs from 'node:fs';
import * as path from 'node:path';

export function loadAgentSpec(name: 'groundwork-main' | 'groundwork-inline', modelOverride?: string): any {
  const filePath = path.resolve(__dirname, `../agent/${name}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (modelOverride && parsed.manifest && parsed.manifest.model) {
    parsed.manifest.model.name = modelOverride;
  }
  return parsed.manifest;
}

export async function registerAgents(baseUrl = 'http://localhost:8790'): Promise<void> {
  const mainSpec = loadAgentSpec('groundwork-main');
  const inlineSpec = loadAgentSpec('groundwork-inline');

  const payloadMain = {
    name: 'groundwork-main',
    description: 'Editor-native coding agent: evidence-based retrieval, reviewed multi-file edits, tests.',
    manifest: mainSpec
  };

  const payloadInline = {
    name: 'groundwork-inline',
    description: 'Edits only the user selected region.',
    manifest: inlineSpec
  };

  for (const agent of [payloadMain, payloadInline]) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent)
      });
      if (res.ok) {
        console.log(`Agent ${agent.name} registered successfully`);
      } else {
        const text = await res.text();
        console.warn(`Agent ${agent.name} registration status: ${res.status} (${text})`);
      }
    } catch (err: any) {
      console.warn(`Could not reach TrueForge at ${baseUrl}: ${err.message}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('register-agents.ts')) {
  registerAgents().then(() => console.log('Done registering agents.'));
}
