import type { RankedFile } from '../types';
import { coChange } from './cochange';

export function rankFiles(
  query: string,
  bm25: Map<string, { score: number; hits: number }>,
  commits: string[][],
  imports: Map<string, Set<string>>,
  k = 8
): RankedFile[] {
  const effectiveK = Math.min(Math.max(1, k), 8);

  // Normalize BM25
  let maxBm25 = 0;
  for (const item of bm25.values()) {
    if (item.score > maxBm25) {
      maxBm25 = item.score;
    }
  }

  // Top-3 BM25 files
  const sortedBm25 = Array.from(bm25.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .map(([path]) => path);

  const top3 = sortedBm25.slice(0, 3);

  // Precompute co-change for top-3
  const topCoChanges = new Map<string, Map<string, number>>();
  for (const t of top3) {
    topCoChanges.set(t, coChange(commits, t));
  }

  // Collect candidate files (all bm25 files, plus co-change partners of top3, plus direct import neighbors)
  const candidateSet = new Set<string>(bm25.keys());
  for (const t of top3) {
    const coMap = topCoChanges.get(t);
    if (coMap) {
      for (const other of coMap.keys()) {
        candidateSet.add(other);
      }
    }
    const impSet = imports.get(t);
    if (impSet) {
      for (const neighbor of impSet) {
        candidateSet.add(neighbor);
      }
    }
  }

  const results: RankedFile[] = [];

  for (const filePath of candidateSet) {
    const bmData = bm25.get(filePath);
    const normBm25 = maxBm25 > 0 ? (bmData ? bmData.score / maxBm25 : 0) : 0;
    const hits = bmData?.hits ?? 0;

    let bestCoChange = 0;
    let bestCoPartner = '';
    for (const t of top3) {
      if (t === filePath) continue;
      const coMap = topCoChanges.get(t);
      const val = coMap?.get(filePath) ?? 0;
      if (val > bestCoChange) {
        bestCoChange = val;
        bestCoPartner = t;
      }
    }

    let importSignal = 0;
    let bestImportPartner = '';
    const neighbors = imports.get(filePath);
    if (neighbors) {
      for (const t of top3) {
        if (t === filePath) continue;
        if (neighbors.has(t)) {
          importSignal = 1;
          bestImportPartner = t;
          break;
        }
      }
    }

    const rawScore = 0.6 * normBm25 + 0.25 * bestCoChange + 0.15 * importSignal;
    const score = Math.round(rawScore * 100) / 100;

    const evidenceParts: string[] = [];
    if (hits > 0) {
      evidenceParts.push(`${hits} keyword hits`);
    }
    if (bestCoChange > 0 && bestCoPartner) {
      const pct = Math.round(bestCoChange * 100);
      evidenceParts.push(`changed with ${bestCoPartner} in ${pct}% of commits`);
    }
    if (importSignal > 0 && bestImportPartner) {
      evidenceParts.push(`imported by / imports ${bestImportPartner}`);
    }

    results.push({
      path: filePath,
      score,
      evidence: evidenceParts.join('; ') || 'related symbol/structure',
    });
  }

  // Sort descending by score, tiebreak by hits
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, effectiveK);
}
