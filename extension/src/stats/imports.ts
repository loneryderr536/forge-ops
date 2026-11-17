import * as path from 'node:path';

export function buildImportGraph(
  files: Map<string, string>,
  packageRoots: string[] = ['src', '.']
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const f of files.keys()) {
    graph.set(f, new Set<string>());
  }

  const knownPaths = new Set(Array.from(files.keys()).map((p) => p.replace(/\\/g, '/')));

  function findCandidate(candidateRel: string): string | undefined {
    const c = candidateRel.replace(/\\/g, '/');
    if (knownPaths.has(c)) return c;
    if (knownPaths.has(c + '.py')) return c + '.py';
    if (knownPaths.has(c + '/__init__.py')) return c + '/__init__.py';
    return undefined;
  }

  for (const [filePath, content] of files.entries()) {
    const normFilePath = filePath.replace(/\\/g, '/');
    const fileDir = path.posix.dirname(normFilePath);
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      let targetModule: string | null = null;
      let isRelative = false;
      let relDots = 0;

      // Match 'from .x import' or 'from ..x import' or 'from x import'
      const fromMatch = trimmed.match(/^from\s+(\.+)?([a-zA-Z0-9_\.]*)\s+import/);
      if (fromMatch) {
        const dots = fromMatch[1];
        const mod = fromMatch[2];
        if (dots) {
          isRelative = true;
          relDots = dots.length;
          targetModule = mod;
        } else if (mod) {
          targetModule = mod;
        }
      } else {
        const importMatch = trimmed.match(/^import\s+([a-zA-Z0-9_\.]+)/);
        if (importMatch) {
          targetModule = importMatch[1];
        }
      }

      if (!targetModule && !isRelative) continue;

      let resolvedTarget: string | undefined;

      if (isRelative) {
        // e.g. relDots = 1 -> current dir, relDots = 2 -> parent dir
        let baseDir = fileDir;
        for (let d = 1; d < relDots; d++) {
          baseDir = path.posix.dirname(baseDir);
        }
        const relCandidate = targetModule
          ? path.posix.join(baseDir, targetModule.replace(/\./g, '/'))
          : baseDir;
        resolvedTarget = findCandidate(relCandidate);
      } else if (targetModule) {
        const modPath = targetModule.replace(/\./g, '/');
        for (const root of packageRoots) {
          const normRoot = root === '.' ? '' : root.replace(/\\/g, '/');
          const candidate = normRoot ? path.posix.join(normRoot, modPath) : modPath;
          resolvedTarget = findCandidate(candidate);
          if (resolvedTarget) break;
        }
      }

      if (resolvedTarget && resolvedTarget !== normFilePath) {
        const sourceSet = graph.get(normFilePath) ?? new Set();
        sourceSet.add(resolvedTarget);
        graph.set(normFilePath, sourceSet);

        const targetSet = graph.get(resolvedTarget) ?? new Set();
        targetSet.add(normFilePath);
        graph.set(resolvedTarget, targetSet);
      }
    }
  }

  return graph;
}
