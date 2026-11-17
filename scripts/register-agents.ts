import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

export function loadAgentSpec(name: 'Forge-ops' | 'groundwork-main' | 'groundwork-inline', modelOverride?: string): any {
  let filePath = path.resolve(currentDir, `../agent/${name}.json`);
  if (!fs.existsSync(filePath) && name === 'Forge-ops') {
    filePath = path.resolve(currentDir, '../agent/groundwork-main.json');
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (modelOverride && parsed.manifest && parsed.manifest.model) {
    parsed.manifest.model.name = modelOverride;
  }
  return parsed.manifest;
}

export async function registerAgents(baseUrl = 'http://localhost:8790'): Promise<void> {
  const mainSpec = loadAgentSpec('Forge-ops');
  const inlineSpec = loadAgentSpec('groundwork-inline');

  const payloadMain = {
    name: 'forge-ops',
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

type ProviderManifest = Record<string, unknown>;

function providerManifests(env: NodeJS.ProcessEnv): { label: string; manifest: ProviderManifest }[] {
  const out: { label: string; manifest: ProviderManifest }[] = [];
  if (env.GEMINI_API_KEY) {
    out.push({
      label: 'google-gemini',
      manifest: {
        type: 'google-gemini',
        auth: { api_key: env.GEMINI_API_KEY },
        models: [{ model_id: 'gemini-2.5-flash', name: 'gemini-2-5-flash', properties: { context_length: 1000000, max_output_tokens: 8192 } }],
      },
    });
  }
  if (env.GROQ_API_KEY) {
    out.push({
      label: 'groq',
      manifest: {
        type: 'custom',
        name: 'groq',
        base_url: 'https://api.groq.com/openai/v1',
        auth: { api_key: env.GROQ_API_KEY },
        models: [
          { model_id: 'llama-3.3-70b-versatile', name: 'llama-3-3-70b-versatile', properties: { context_length: 128000, max_output_tokens: 8192 } },
          { model_id: 'llama-3.1-8b-instant', name: 'llama-3-1-8b-instant', properties: { context_length: 128000, max_output_tokens: 8192 } },
        ],
      },
    });
  }
  if (env.OLLAMA_BASE_URL) {
    out.push({
      label: 'ollama',
      manifest: {
        type: 'custom',
        name: 'ollama',
        base_url: env.OLLAMA_BASE_URL,
        auth: { api_key: 'ollama' },
        models: [{ model_id: 'qwen2.5-coder:7b', name: 'qwen2-5-coder-7b', properties: { context_length: 32768, max_output_tokens: 4096 } }],
      },
    });
  }
  return out;
}

export async function registerProviders(baseUrl = 'http://localhost:8790', env = process.env): Promise<void> {
  const providers = providerManifests(env);
  if (providers.length === 0) {
    console.warn('No GEMINI_API_KEY / GROQ_API_KEY / OLLAMA_BASE_URL in the environment: no model providers registered.');
  }
  for (const { label, manifest } of providers) {
    try {
      const body = JSON.stringify({ manifest });
      const headers = { 'Content-Type': 'application/json' };
      let res = await fetch(`${baseUrl}/api/v1/settings/model-providers`, { method: 'PUT', headers, body });
      if (!res.ok) res = await fetch(`${baseUrl}/api/v1/settings/model-providers`, { method: 'POST', headers, body });
      if (res.ok) console.log(`Model provider ${label} registered`);
      else console.warn(`Model provider ${label} failed: ${res.status} ${await res.text()}`);
    } catch (err: any) {
      console.warn(`Could not reach TrueForge at ${baseUrl}: ${err.message}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('register-agents.ts')) {
  registerProviders().then(() => registerAgents()).then(() => console.log('Done registering providers and agents.'));
}
