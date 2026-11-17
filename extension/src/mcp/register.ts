export async function registerMcpServer(
  baseUrl: string,
  name = 'groundwork-editor',
  url: string,
  token: string
): Promise<void> {
  const payload = {
    name,
    type: 'remote',
    url,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  try {
    const res = await fetch(`${baseUrl}/api/v1/settings/mcp-servers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Fallback try POST
      await fetch(`${baseUrl}/api/v1/settings/mcp-servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    }
  } catch (err: any) {
    console.warn(`MCP server registration warning: ${err.message}`);
  }
}
