import type { Hunk } from '../types';

export function applyReplace(
  text: string,
  oldStr: string,
  newStr: string
): { ok: true; text: string } | { ok: false; reason: 'not_found' | 'ambiguous' } {
  const isCrlf = text.includes('\r\n');
  const targetOld = isCrlf ? oldStr.replace(/\r?\n/g, '\r\n') : oldStr.replace(/\r\n/g, '\n');
  const targetNew = isCrlf ? newStr.replace(/\r?\n/g, '\r\n') : newStr.replace(/\r\n/g, '\n');

  let firstIndex = text.indexOf(targetOld);
  if (firstIndex === -1) {
    // Try matching normalized
    if (!isCrlf && text.indexOf(oldStr) !== -1) {
      firstIndex = text.indexOf(oldStr);
    } else {
      return { ok: false, reason: 'not_found' };
    }
  }

  const secondIndex = text.indexOf(targetOld, firstIndex + targetOld.length);
  if (secondIndex !== -1) {
    return { ok: false, reason: 'ambiguous' };
  }

  const replaced = text.slice(0, firstIndex) + targetNew + text.slice(firstIndex + targetOld.length);
  return { ok: true, text: replaced };
}

interface DiffOp {
  type: 'equal' | 'delete' | 'insert';
  line: string;
}

function diffLinesInternal(before: string, after: string): DiffOp[] {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  const n = beforeLines.length;
  const m = afterLines.length;

  // DP table for LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (beforeLines[i] === afterLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack
  let i = n;
  let j = m;
  const ops: DiffOp[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      ops.push({ type: 'equal', line: beforeLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', line: afterLines[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      ops.push({ type: 'delete', line: beforeLines[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

function splitLines(str: string): string[] {
  if (str.length === 0) return [];
  const lines = str.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function computeHunks(before: string, after: string): Hunk[] {
  const ops = diffLinesInternal(before, after);
  const hunks: Hunk[] = [];
  let currentOldLine = 1;
  let hunkIndex = 0;

  let idx = 0;
  while (idx < ops.length) {
    const op = ops[idx];
    if (op.type === 'equal') {
      currentOldLine++;
      idx++;
      continue;
    }

    const hunkStart = currentOldLine;
    const oldLines: string[] = [];
    const newLines: string[] = [];

    while (idx < ops.length && ops[idx].type !== 'equal') {
      if (ops[idx].type === 'delete') {
        oldLines.push(ops[idx].line);
        currentOldLine++;
      } else if (ops[idx].type === 'insert') {
        newLines.push(ops[idx].line);
      }
      idx++;
    }

    hunks.push({
      id: `h${hunkIndex++}`,
      oldStart: hunkStart,
      oldLines,
      newLines,
    });
  }

  return hunks;
}

export function applySelectedHunks(
  before: string,
  after: string,
  acceptedIds: string[]
): string {
  const isCrlf = before.includes('\r\n');
  const eol = isCrlf ? '\r\n' : '\n';
  const hasTrailingNewline = before.endsWith('\n');

  const hunks = computeHunks(before, after);
  const acceptedSet = new Set(acceptedIds);

  const beforeLines = splitLines(before);
  const resultLines: string[] = [];

  let curBeforeIdx = 0; // 0-based
  for (const hunk of hunks) {
    const hunkStart0 = hunk.oldStart - 1;
    while (curBeforeIdx < hunkStart0 && curBeforeIdx < beforeLines.length) {
      resultLines.push(beforeLines[curBeforeIdx++]);
    }

    if (acceptedSet.has(hunk.id)) {
      resultLines.push(...hunk.newLines);
    } else {
      resultLines.push(...hunk.oldLines);
    }
    curBeforeIdx += hunk.oldLines.length;
  }

  while (curBeforeIdx < beforeLines.length) {
    resultLines.push(beforeLines[curBeforeIdx++]);
  }

  let res = resultLines.join(eol);
  if (hasTrailingNewline && (res.length > 0 || before.length > 0)) {
    res += eol;
  }
  return res;
}
