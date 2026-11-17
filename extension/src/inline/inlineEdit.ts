export function buildInlinePrompt(
  relPath: string,
  startLine: number,
  endLine: number,
  selected: string,
  instruction: string
): string {
  return [
    `File: ${relPath}`,
    `Lines: ${startLine}-${endLine}`,
    'Selected code:',
    selected,
    `Instruction: ${instruction}`,
  ].join('\n');
}
