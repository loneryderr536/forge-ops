export function buildRepoMap(files: Map<string, string>, maxTokens = 3000): string {
  const maxChars = maxTokens * 4;
  const lines: string[] = ['# Repository Map'];

  const sortedPaths = Array.from(files.keys()).sort();

  for (const filePath of sortedPaths) {
    if (filePath.includes('.git/') || filePath.includes('node_modules/') || filePath.includes('.venv/')) {
      continue;
    }

    const content = files.get(filePath) || '';
    const defs: string[] = [];
    const contentLines = content.split(/\r?\n/);

    for (const l of contentLines) {
      const match = l.match(/^(?:def|class)\s+([a-zA-Z0-9_]+)/);
      if (match) {
        defs.push(match[1]);
      }
    }

    let fileEntry = `- ${filePath}`;
    if (defs.length > 0) {
      fileEntry += ` [${defs.slice(0, 10).join(', ')}${defs.length > 10 ? ', …' : ''}]`;
    }

    lines.push(fileEntry);

    // Check token budget limit
    if (lines.join('\n').length > maxChars - 100) {
      lines.push('… [remaining files trimmed to stay within context budget]');
      break;
    }
  }

  return lines.join('\n');
}
