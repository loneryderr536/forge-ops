export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class ContextMeter {
  private budget: number;
  private usedTokens = 0;
  private seenFiles = new Set<string>();

  constructor(budget = 25000) {
    this.budget = budget;
  }

  add(filePath: string | null, text: string): void {
    if (filePath) {
      this.seenFiles.add(filePath);
    }
    this.usedTokens += estimateTokens(text);
  }

  snapshot(): { used: number; budget: number; files: number } {
    return {
      used: this.usedTokens,
      budget: this.budget,
      files: this.seenFiles.size,
    };
  }

  reset(): void {
    this.usedTokens = 0;
    this.seenFiles.clear();
  }
}
