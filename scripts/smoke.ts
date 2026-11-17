import { loadAgentSpec } from './register-agents';

async function main() {
  const baseUrl = process.env.TRUEFORGE_URL || 'http://localhost:8790';
  console.log(`Connecting to TrueForge at ${baseUrl}...`);
  try {
    const spec = loadAgentSpec('Forge-ops');
    console.log(`Loaded Forge-ops manifest: model=${spec.model?.name}`);
  } catch (e: any) {
    console.error(`Smoke test failed: ${e.message}`);
  }
}

main();
