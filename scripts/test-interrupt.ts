#!/usr/bin/env node
/**
 * STEP 1: Interrupt mechanism investigation
 * Tests whether SIGINT to the child process interrupts the current turn
 * while keeping the session alive.
 *
 * Usage: pnpm tsx scripts/test-interrupt.ts
 */
import { ClaudeSession } from '../src/claude/session.js';

async function main(): Promise<void> {
  console.log('[INTERRUPT-TEST] Starting investigation...');

  const session = new ClaudeSession('interrupt-test');
  let sessionDied = false;
  let gotStatusWaiting = false;
  let gotPong = false;

  session.on('event', (evt: unknown) => {
    const e = evt as Record<string, unknown>;
    if (e['type'] === 'text_delta') return; // Skip streaming chars
    console.log('[EVENT]', JSON.stringify(e));
    if (e['type'] === 'error') sessionDied = true;
    if (e['type'] === 'status' && e['status'] === 'waiting') gotStatusWaiting = true;
    if (e['type'] === 'waiting' && e['state'] === true) gotStatusWaiting = true;
    if (e['type'] === 'message_complete') {
      const text = String(e['text'] ?? '');
      if (text.includes('PONG')) gotPong = true;
    }
  });

  session.start();
  console.log('[INTERRUPT-TEST] Waiting for init...');
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));

  // Send a long request
  console.log('[INTERRUPT-TEST] Sending long counting request...');
  session.sendMessage('Count from 1 to 500, printing each number on a new line. Take your time.');

  // Wait 3s then interrupt
  await new Promise<void>((resolve) => setTimeout(resolve, 3000));
  console.log('[INTERRUPT-TEST] Sending interrupt (SIGINT)...');
  session.interrupt();

  // Wait 4s to see what happens
  await new Promise<void>((resolve) => setTimeout(resolve, 4000));

  if (sessionDied) {
    console.log('\n=== RESULT: SIGINT KILLED THE SESSION ===');
    console.log('Interrupt method: SIGINT kills the process.');
    console.log('Conclusion: Session restart needed for interrupt. No clean turn-abort available.');
    session.stop();
    process.exit(0);
  }

  console.log('[INTERRUPT-TEST] Session still alive! gotStatusWaiting:', gotStatusWaiting);
  console.log('[INTERRUPT-TEST] Sending PONG to verify session...');
  session.sendMessage('Reply with exactly: PONG');

  const pongTimeout = setTimeout(() => {
    console.log('\n=== RESULT: TIMEOUT — Session alive but no PONG in 30s ===');
    session.stop();
    process.exit(0);
  }, 30000);

  const poll = setInterval(() => {
    if (gotPong) {
      clearInterval(poll);
      clearTimeout(pongTimeout);
      console.log('\n=== RESULT: SIGINT INTERRUPTED TURN, SESSION ALIVE ===');
      console.log('Interrupt method: SIGINT works. Session responded PONG after interrupt.');
      console.log('Conclusion: SIGINT cleanly aborts current turn and session stays alive.');
      session.stop();
      process.exit(0);
    }
  }, 500);
}

main().catch((err: unknown) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
