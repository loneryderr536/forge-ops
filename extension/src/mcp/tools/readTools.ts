import { resolveInWorkspace } from '../guards';
import type { ToolDeps } from './toolDeps';

export async function readFileTool(
  args: { path: string; start_line?: number; end_line?: number },
  deps: ToolDeps
): Promise<string> {
  const absPath = resolveInWorkspace(deps.root, args.path);
  const text = await deps.readText(absPath);

  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  // If text ends with newline, pop empty trailing element for line count accuracy if desirable, or preserve
  const lines = rawLines.length > 1 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;

  const totalLines = lines.length;
  const start = Math.max(1, args.start_line ?? 1);
  const end = Math.min(totalLines, args.end_line ?? totalLines);

  const sliced = lines.slice(start - 1, end);
  const maxLines = 300;
  const isTruncated = sliced.length > maxLines;
  const displayLines = isTruncated ? sliced.slice(0, maxLines) : sliced;

  const output: string[] = [];
  for (let i = 0; i < displayLines.length; i++) {
    output.push(`${start + i}: ${displayLines[i]}`);
  }

  if (isTruncated) {
    output.push('… truncated, use start_line/end_line');
  }

  return output.join('\n');
}

export async function listFilesTool(
  args: { glob?: string },
  deps: ToolDeps
): Promise<string> {
  const pattern = args.glob || '**/*';
  const files = await deps.listFiles(pattern, 200);
  return files.slice(0, 200).join('\n');
}

export async function searchTool(
  args: { query: string; glob?: string; regex?: boolean },
  deps: ToolDeps
): Promise<string> {
  const pattern = args.glob || '**/*';
  const files = await deps.listFiles(pattern, 200);
  const hits: string[] = [];
  const maxHits = 50;

  let matcher: (line: string) => boolean;
  if (args.regex) {
    try {
      const reg = new RegExp(args.query, 'i');
      matcher = (line) => reg.test(line);
    } catch {
      matcher = (line) => line.toLowerCase().includes(args.query.toLowerCase());
    }
  } else {
    const qLower = args.query.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(qLower);
  }

  for (const relPath of files) {
    if (hits.length >= maxHits) break;
    // Skip binary/noisy dirs
    if (relPath.includes('.git/') || relPath.includes('node_modules/') || relPath.includes('.venv/')) {
      continue;
    }

    try {
      const absPath = resolveInWorkspace(deps.root, relPath);
      const content = await deps.readText(absPath);
      const lines = content.replace(/\r\n/g, '\n').split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= maxHits) break;
        if (matcher(lines[i])) {
          hits.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    } catch {
      // Ignore unreadable files
    }
  }

  return hits.join('\n');
}
