export interface ParsedMentions {
  files: string[];
  symbols: string[];
  rest: string;
}

export function parseMentions(input: string): ParsedMentions {
  const files: string[] = [];
  const symbols: string[] = [];

  // Match @#symbol
  let working = input.replace(/@#([a-zA-Z0-9_]+)/g, (_, sym) => {
    symbols.push(sym);
    return '';
  });

  // Match @file_path
  working = working.replace(/@([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/g, (_, f) => {
    files.push(f);
    return '';
  });

  // Clean extra spaces
  const rest = working.replace(/\s+/g, ' ').trim();

  return { files, symbols, rest };
}
