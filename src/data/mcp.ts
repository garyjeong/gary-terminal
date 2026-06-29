import { execa } from 'execa';

export type McpStatus = 'connected' | 'auth' | 'error' | 'unknown';

export interface McpInfo {
  name: string;
  status: McpStatus;
}

export async function fetchMcpList(): Promise<McpInfo[]> {
  try {
    const result = await execa('claude', ['mcp', 'list'], {
      timeout: 30_000,
      reject: false,
    });
    const stdout = result.stdout ?? '';
    const lines = stdout.split('\n');
    const items: McpInfo[] = [];

    for (const line of lines) {
      // Format: "<name>: <url-or-cmd> - <status>" (name may contain spaces,
      // line starts at column 0). Skip the "Checking MCP server health…" header
      // and any line without a "name:" prefix.
      const match = line.match(/^\s*([^:]+):\s/);
      if (!match || !match[1]) continue;
      const name = match[1].trim();
      if (!name || name.toLowerCase().startsWith('checking')) continue;

      let status: McpStatus;
      if (line.includes('Connected')) {
        status = 'connected';
      } else if (
        line.toLowerCase().includes('authentication') ||
        line.toLowerCase().includes('auth')
      ) {
        status = 'auth';
      } else {
        status = 'error';
      }

      items.push({ name, status });
    }

    return items;
  } catch {
    return [];
  }
}
