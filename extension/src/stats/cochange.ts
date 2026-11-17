export function parseGitLog(raw: string, maxFilesPerCommit = 30): string[][] {
  const lines = raw.split(/\r?\n/);
  const commits: string[][] = [];
  let currentFiles: Set<string> = new Set();
  let inCommit = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if line is a commit hash (40 hex chars)
    if (/^[0-9a-f]{40}$/i.test(trimmed)) {
      if (inCommit) {
        if (currentFiles.size > 0 && currentFiles.size <= maxFilesPerCommit) {
          commits.push(Array.from(currentFiles));
        }
      }
      currentFiles = new Set();
      inCommit = true;
    } else if (inCommit) {
      currentFiles.add(trimmed);
    }
  }

  if (inCommit && currentFiles.size > 0 && currentFiles.size <= maxFilesPerCommit) {
    commits.push(Array.from(currentFiles));
  }

  return commits;
}

export function coChange(commits: string[][], path: string): Map<string, number> {
  const normPath = path.replace(/\\/g, '/');
  let pathCommits = 0;
  const coCounts = new Map<string, number>();

  for (const commit of commits) {
    const hasPath = commit.some((f) => f.replace(/\\/g, '/') === normPath);
    if (hasPath) {
      pathCommits++;
      for (const f of commit) {
        const normF = f.replace(/\\/g, '/');
        if (normF !== normPath) {
          coCounts.set(normF, (coCounts.get(normF) ?? 0) + 1);
        }
      }
    }
  }

  const result = new Map<string, number>();
  if (pathCommits === 0) {
    return result;
  }

  for (const [other, count] of coCounts.entries()) {
    result.set(other, count / pathCommits);
  }

  return result;
}
