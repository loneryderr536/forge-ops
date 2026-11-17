import * as path from 'node:path';

export function resolveInWorkspace(root: string, p: string): string {
  const normalizedRoot = path.resolve(root);
  const normalizedP = p.replace(/\\/g, '/');

  let resolved: string;
  if (path.isAbsolute(normalizedP)) {
    resolved = path.resolve(normalizedP);
  } else {
    resolved = path.resolve(normalizedRoot, normalizedP);
  }

  const rootPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  if (resolved !== normalizedRoot && !resolved.startsWith(rootPrefix)) {
    throw new Error('path outside workspace');
  }

  return resolved;
}
