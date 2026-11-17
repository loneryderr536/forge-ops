import type { ToolDeps } from './toolDeps';

export async function repoMapTool(deps: ToolDeps): Promise<string> {
  return await deps.stats.repoMap();
}

export async function rankFilesTool(
  args: { query: string; k?: number },
  deps: ToolDeps
): Promise<string> {
  const ranked = await deps.stats.rank(args.query, args.k);
  if (ranked.length === 0) {
    return 'No matching files found.';
  }

  const rows = [
    '| path | score | evidence |',
    '| --- | --- | --- |',
  ];

  for (const item of ranked) {
    rows.push(`| ${item.path} | ${item.score.toFixed(2)} | ${item.evidence} |`);
  }

  return rows.join('\n');
}

export async function coChangeTool(
  args: { path: string; k?: number },
  deps: ToolDeps
): Promise<string> {
  const list = await deps.stats.coChange(args.path, args.k);
  if (list.length === 0) {
    return `No co-change history found for ${args.path}.`;
  }

  return list.map((item) => `${item.path}: ${item.pct}% co-change`).join('\n');
}

export async function findSymbolTool(
  args: { name: string },
  deps: ToolDeps
): Promise<string> {
  const hits = await deps.stats.findSymbol(args.name);
  if (hits.length === 0) {
    return `Symbol '${args.name}' not found.`;
  }

  return hits.join('\n');
}
