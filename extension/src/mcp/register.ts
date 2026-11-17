export async function registerMcpServer(
  baseUrl: string,
  name = 'groundwork-editor',
  url: string,
  token: string
): Promise<void> {
  const payload = JSON.stringify({
    manifest: {
      type: 'remote',
      name,
      description: 'Groundwork VS Code editor tools (read, search, rank, edit, run).',
      url,
      auth: { type: 'header', headers: { Authorization: `Bearer ${token}` } },
    },
  });
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/v1/settings/mcp-servers`;
  const headers = { 'Content-Type': 'application/json' };

  const put = await fetch(endpoint, { method: 'PUT', headers, body: payload });
  if (put.ok) return;

  const post = await fetch(endpoint, { method: 'POST', headers, body: payload });
  if (post.ok) return;

  const detail = await post.text().catch(() => '');
  throw new Error(`MCP registration failed (PUT ${put.status}, POST ${post.status}) ${detail}`.trim());
}
