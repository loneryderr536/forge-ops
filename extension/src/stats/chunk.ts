export interface Chunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export function chunkFile(pathStr: string, text: string): Chunk[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return [];
  }

  const chunks: Chunk[] = [];
  const ext = pathStr.slice(pathStr.lastIndexOf('.')).toLowerCase();

  if (ext === '.py') {
    let currentStart = 1;
    let currentLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTopLevelDefOrClass = /^(def|class)\s+[a-zA-Z0-9_]+/.test(line);

      if (isTopLevelDefOrClass && i > 0 && currentLines.length > 0) {
        chunks.push({
          path: pathStr,
          startLine: currentStart,
          endLine: i,
          text: currentLines.join('\n'),
        });
        currentStart = i + 1;
        currentLines = [];
      }
      currentLines.push(line);
    }

    if (currentLines.length > 0) {
      chunks.push({
        path: pathStr,
        startLine: currentStart,
        endLine: lines.length,
        text: currentLines.join('\n'),
      });
    }
  } else if (ext === '.md' || ext === '.rst') {
    let currentStart = 1;
    let currentLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const isMdHeading = /^#{1,6}\s+/.test(line);
      const isRstHeading = ext === '.rst' && /^[=\-~`:#"^_*+]{3,}\s*$/.test(nextLine) && line.trim().length > 0;

      if ((isMdHeading || isRstHeading) && i > 0 && currentLines.length > 0) {
        chunks.push({
          path: pathStr,
          startLine: currentStart,
          endLine: i,
          text: currentLines.join('\n'),
        });
        currentStart = i + 1;
        currentLines = [];
      }
      currentLines.push(line);
    }

    if (currentLines.length > 0) {
      chunks.push({
        path: pathStr,
        startLine: currentStart,
        endLine: lines.length,
        text: currentLines.join('\n'),
      });
    }
  } else {
    // 80 lines per chunk
    const chunkSize = 80;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const slice = lines.slice(i, i + chunkSize);
      chunks.push({
        path: pathStr,
        startLine: i + 1,
        endLine: Math.min(lines.length, i + chunkSize),
        text: slice.join('\n'),
      });
    }
  }

  return chunks;
}
