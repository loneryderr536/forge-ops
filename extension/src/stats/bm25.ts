import type { Chunk } from './chunk';
import { tokenize } from './tokenize';

export class Bm25Index {
  private chunks: Chunk[];
  private k1: number;
  private b: number;
  private chunkTokens: string[][];
  private avgdl: number;
  private df: Map<string, number> = new Map();
  private fileChunks: Map<string, number[]> = new Map();

  constructor(chunks: Chunk[], k1 = 1.2, b = 0.75) {
    this.chunks = chunks;
    this.k1 = k1;
    this.b = b;

    let totalTokens = 0;
    this.chunkTokens = chunks.map((c, idx) => {
      const tokens = tokenize(c.text);
      totalTokens += tokens.length;

      const seen = new Set(tokens);
      for (const t of seen) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }

      const list = this.fileChunks.get(c.path) ?? [];
      list.push(idx);
      this.fileChunks.set(c.path, list);

      return tokens;
    });

    this.avgdl = chunks.length > 0 ? totalTokens / chunks.length : 1;
  }

  scoreFiles(query: string): Map<string, { score: number; hits: number }> {
    const qTokens = tokenize(query);
    const N = this.chunks.length;
    const result = new Map<string, { score: number; hits: number }>();

    if (qTokens.length === 0 || N === 0) {
      return result;
    }

    // Compute IDF for each query token
    const idf = new Map<string, number>();
    for (const q of qTokens) {
      const docFreq = this.df.get(q) ?? 0;
      const val = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
      idf.set(q, Math.max(0.01, val));
    }

    // Score each chunk
    const chunkScores = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const tokens = this.chunkTokens[i];
      const docLen = tokens.length;
      if (docLen === 0) continue;

      // Count term frequencies
      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }

      let chunkScore = 0;
      for (const q of qTokens) {
        const count = tf.get(q) ?? 0;
        if (count > 0) {
          const qIdf = idf.get(q) ?? 0;
          const numerator = count * (this.k1 + 1);
          const denominator = count + this.k1 * (1 - this.b + this.b * (docLen / this.avgdl));
          chunkScore += qIdf * (numerator / denominator);
        }
      }
      chunkScores[i] = chunkScore;
    }

    // Aggregate by file
    for (const [filePath, chunkIndices] of this.fileChunks.entries()) {
      const scores = chunkIndices.map((i) => chunkScores[i]).sort((a, b) => b - a);
      const maxScore = scores[0] || 0;
      const top3 = scores.slice(0, 3);
      const meanTop3 = top3.length > 0 ? top3.reduce((a, b) => a + b, 0) / top3.length : 0;
      const finalScore = maxScore + 0.5 * meanTop3;

      // Count total hits across the file
      let hits = 0;
      for (const i of chunkIndices) {
        const tokens = this.chunkTokens[i];
        for (const t of tokens) {
          if (qTokens.includes(t)) {
            hits++;
          }
        }
      }

      if (hits > 0 || finalScore > 0) {
        result.set(filePath, { score: finalScore, hits });
      }
    }

    return result;
  }
}
