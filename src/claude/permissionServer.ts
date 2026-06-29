import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync } from 'node:fs';

interface PendingRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  resolve: (decision: 'allow' | 'deny') => void;
}

export interface PermissionRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export class PermissionServer {
  private server: Server | null = null;
  private port = 0;
  private queue: PendingRequest[] = [];
  private onRequest: ((req: PermissionRequest) => void) | null = null;

  setOnRequest(handler: (req: PermissionRequest) => void): void {
    this.onRequest = handler;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this._handleRequest.bind(this));
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  private _handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body) as Record<string, unknown>;
        const toolUseId = String(data['tool_use_id'] ?? '');
        const toolName = String(data['tool_name'] ?? '');
        const toolInput = (data['tool_input'] as Record<string, unknown>) ?? {};

        new Promise<'allow' | 'deny'>((resolveDecision) => {
          const isFirst = this.queue.length === 0;
          this.queue.push({ toolName, toolInput, toolUseId, resolve: resolveDecision });
          if (isFirst) {
            this.onRequest?.({ toolName, toolInput, toolUseId });
          }
        }).then((decision) => {
          const responseObj = {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: decision,
              permissionDecisionReason: decision === 'allow'
                ? 'User approved in gary-terminal'
                : 'User denied in gary-terminal',
            },
          };
          const responseBody = JSON.stringify(responseObj);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(responseBody) });
          res.end(responseBody);

          // Remove from queue and show next
          this.queue = this.queue.filter((p) => p.toolUseId !== toolUseId);
          if (this.queue.length > 0) {
            const next = this.queue[0]!;
            this.onRequest?.({ toolName: next.toolName, toolInput: next.toolInput, toolUseId: next.toolUseId });
          }
        }).catch(() => {
          res.writeHead(500).end('{}');
        });
      } catch {
        res.writeHead(400).end('{}');
      }
    });
  }

  resolvePermission(toolUseId: string, decision: 'allow' | 'deny'): void {
    const pending = this.queue.find((p) => p.toolUseId === toolUseId);
    if (pending) {
      pending.resolve(decision);
    }
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    // Resolve all pending as allow so commands aren't blocked forever
    for (const p of this.queue) {
      p.resolve('allow');
    }
    this.queue = [];
  }

  writeSettingsFile(path: string): void {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'http',
                url: `http://127.0.0.1:${this.port}/permission`,
                timeout: 300, // 5 min — wait for user decision
              },
            ],
          },
        ],
      },
    };
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
  }
}
