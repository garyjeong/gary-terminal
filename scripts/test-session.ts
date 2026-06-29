#!/usr/bin/env node
/**
 * Standalone round-trip test for session.ts
 * Usage: pnpm tsx scripts/test-session.ts
 */
import { ClaudeSession } from '../src/claude/session.js';

async function main(): Promise<void> {
  console.log('[TEST] Starting ClaudeSession round-trip test...');

  const session = new ClaudeSession('test');
  let resolved = false;

  const cleanup = (code: number) => {
    if (!resolved) {
      resolved = true;
      session.stop();
      process.exit(code);
    }
  };

  session.on('event', (evt: unknown) => {
    const e = evt as Record<string, unknown>;
    console.log('[EVENT]', JSON.stringify(e));

    if (e['type'] === 'error') {
      console.error('[FAIL] Error event:', e['message']);
      cleanup(1);
    }

    // Verify CTX% data
    if (e['type'] === 'usage') {
      const contextTokens = Number(e['contextTokens'] ?? 0);
      const contextWindow = Number(e['contextWindow'] ?? 0);
      if (contextTokens > 0) {
        const pct = contextWindow > 0 ? ((contextTokens / contextWindow) * 100).toFixed(1) : '?';
        console.log(`\n=== CTX VERIFIED: contextTokens=${contextTokens}, contextWindow=${contextWindow}, pct=${pct}% ===`);
      } else {
        console.warn('[WARN] usage event has contextTokens=0');
      }
    }
  });

  session.start();

  // Wait a moment for session to initialize, then send test message
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));

  console.log('[SEND] Reply with exactly: PONG');
  session.sendMessage('Reply with exactly: PONG');

  // Wait for response (up to 60s)
  const timeout = setTimeout(() => {
    console.error('[FAIL] Timeout after 60s');
    cleanup(1);
  }, 60000);

  // Poll for PONG in session events
  session.on('event', (evt: unknown) => {
    const e = evt as Record<string, unknown>;
    if (e['type'] === 'message_complete') {
      const text = String(e['text'] ?? '');
      console.log('[GOT] message_complete:', text);
      if (text.includes('PONG')) {
        console.log('\n=== SUCCESS: Got PONG ===');
        clearTimeout(timeout);
        // Wait briefly for result/cost event
        setTimeout(() => cleanup(0), 3000);
      }
    }
  });
}

main().catch((err: unknown) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
