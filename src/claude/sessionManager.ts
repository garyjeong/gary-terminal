/**
 * M2-A — Session Manager
 *
 * Manages a Map<agentId, ClaudeSession> so that multiple independent
 * claude sessions can run concurrently. The App creates sessions here;
 * event wiring (store updates) is done in App.tsx where React context
 * is available.
 */

import { ClaudeSession } from './session.js';

export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();

  /**
   * Create (or replace) a session for the given agent ID.
   * Stops the previous session if one exists.
   * Callers must invoke session.start(opts?) explicitly after wiring events.
   */
  create(agentId: string): ClaudeSession {
    const existing = this.sessions.get(agentId);
    if (existing) {
      existing.stop();
    }
    const session = new ClaudeSession(agentId);
    this.sessions.set(agentId, session);
    return session;
  }

  get(agentId: string): ClaudeSession | undefined {
    return this.sessions.get(agentId);
  }

  destroy(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.stop();
      this.sessions.delete(agentId);
    }
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }
}
