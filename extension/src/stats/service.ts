import type { RankedFile } from '../types';
import { Chunk, chunkFile } from './chunk';
import { Bm25Index } from './bm25';
import { parseGitLog, coChange } from './cochange';
import { buildImportGraph } from './imports';
import { rankFiles } from './rank';
import { buildRepoMap } from './repoMap';
import { resolveInWorkspace } from '../mcp/guards';

export interface StatsServiceDeps {
  root: string;
  listFiles(glob: string, max: number): Promise<string[]>;
  readText(absPath: string): Promise<string>;
  runCommand(cmd: string, timeoutS: number, signal: AbortSignal): Promise<{ exitCode: number | null; output: string }>;
}

export class StatsService {
  private deps: StatsServiceDeps;
  private isReady = false;
  private files = new Map<string, string>();
  private chunks: Chunk[] = [];
  private bm25Index!: Bm25Index;
  private commits: string[][] = [];
  private importGraph: Map<string, Set<string>> = new Map();

  constructor(deps: StatsServiceDeps) {
    this.deps = deps;
  }

  async ready(): Promise<void> {
    if (this.isReady) return;

    try {
      // 1. Collect files (up to 500 relevant source files)
      const filePaths = await this.deps.listFiles('**/*', 500);
      for (const p of filePaths) {
        if (p.includes('.git/') || p.includes('node_modules/') || p.includes('.venv/')) {
          continue;
        }
        try {
          const abs = resolveInWorkspace(this.deps.root, p);
          const content = await this.deps.readText(abs);
          this.files.set(p, content);

          const fileChunks = chunkFile(p, content);
          this.chunks.push(...fileChunks);
        } catch {
          // ignore unreadable files
        }
      }

      // 2. BM25 Index
      this.bm25Index = new Bm25Index(this.chunks);

      // 3. Git commits for co-change
      try {
        const gitRes = await this.deps.runCommand(
          'git log --name-only --pretty=format:%H -n 3000',
          30,
          new AbortController().signal
        );
        if (gitRes.exitCode === 0 && gitRes.output) {
          this.commits = parseGitLog(gitRes.output, 30);
        }
      } catch {
        this.commits = [];
      }

      // 4. Import graph
      this.importGraph = buildImportGraph(this.files, ['src', '.']);

      this.isReady = true;
    } catch (e) {
      console.warn('StatsService ready error:', e);
      this.isReady = true; // allow partial degraded operation
    }
  }

  async rank(query: string, k = 8): Promise<RankedFile[]> {
    await this.ready();
    const bmScores = this.bm25Index ? this.bm25Index.scoreFiles(query) : new Map();
    return rankFiles(query, bmScores, this.commits, this.importGraph, k);
  }

  async coChange(filePath: string, k = 8): Promise<Array<{ path: string; pct: number }>> {
    await this.ready();
    const map = coChange(this.commits, filePath);
    const list: Array<{ path: string; pct: number }> = [];
    for (const [p, val] of map.entries()) {
      list.push({ path: p, pct: Math.round(val * 100) });
    }
    list.sort((a, b) => b.pct - a.pct);
    return list.slice(0, k);
  }

  async repoMap(): Promise<string> {
    await this.ready();
    return buildRepoMap(this.files, 3000);
  }

  async findSymbol(name: string): Promise<string[]> {
    await this.ready();
    const regex = new RegExp(`^\\s*(?:def|class)\\s+${name}\\b`);
    const hits: string[] = [];

    for (const [filePath, content] of this.files.entries()) {
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          hits.push(`${filePath}:${i + 1}`);
        }
      }
    }

    return hits;
  }
}
