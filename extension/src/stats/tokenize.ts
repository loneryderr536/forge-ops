export function tokenize(text: string): string[] {
  if (!text) return [];

  // Split on snake_case, camelCase, and non-alphanumerics
  // First insert space before uppercase letters that follow lowercase or uppercase sequences
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ');

  const tokens = spaced.toLowerCase().split(/\s+/);
  return tokens.filter((t) => t.length >= 2);
}
