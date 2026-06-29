/**
 * useAltScreen — manages the alternate screen buffer for fullscreen TUI.
 *
 * On mount: enters the alt screen + clears it.
 * On every exit path (React cleanup, SIGINT, SIGTERM, uncaught errors): restores
 * the original screen so the user's terminal scrollback is left intact.
 *
 * No-op in non-TTY environments (CI, piped output, test runners).
 *
 * @param onCleanup  Called before process.exit() on SIGINT/SIGTERM/uncaught.
 *   Use this to set stopped=true on all sessions so their proc.catch() handlers
 *   don't surface "Command failed with exit code 143" in the conversation.
 */
import { useEffect, useRef } from 'react';

const ENTER_ALT = '\x1b[?1049h\x1b[2J\x1b[H';
const EXIT_ALT = '\x1b[?1049l';

export function useAltScreen(onCleanup?: () => void): void {
  // Use a ref so the effect closure always calls the latest callback even
  // though the effect itself only runs once ([] deps).
  const cleanupRef = useRef(onCleanup);
  cleanupRef.current = onCleanup;

  useEffect(() => {
    if (!process.stdout.isTTY) return;

    // Guard against double-restore across overlapping exit paths.
    let restored = false;
    const restore = (): void => {
      if (restored) return;
      restored = true;
      try {
        process.stdout.write(EXIT_ALT);
      } catch {
        // Ignore write errors during teardown (stream may already be closed).
      }
    };

    // Handlers for each exit path.
    // IMPORTANT: call onCleanup BEFORE restore/exit so that all sessions have
    // stopped=true set before their child processes are reaped — preventing
    // spurious "exit code 143" error messages in the conversation.
    const onSIGINT = (): void => {
      cleanupRef.current?.();
      restore();
      process.exit(130);
    };
    const onSIGTERM = (): void => {
      cleanupRef.current?.();
      restore();
      process.exit(143);
    };
    const onUncaughtException = (err: Error): void => {
      cleanupRef.current?.();
      restore();
      process.stderr.write(`\nUncaught exception: ${String(err)}\n`);
      process.exit(1);
    };
    const onUnhandledRejection = (reason: unknown): void => {
      cleanupRef.current?.();
      restore();
      process.stderr.write(`\nUnhandled rejection: ${String(reason)}\n`);
      process.exit(1);
    };

    // Enter alt screen.
    process.stdout.write(ENTER_ALT);

    // Register all exit paths.
    process.on('exit', restore);           // Normal exit (sync, safe to write)
    process.on('SIGINT', onSIGINT);        // Ctrl+C from outside ink
    process.on('SIGTERM', onSIGTERM);      // kill signal
    process.on('uncaughtException', onUncaughtException);
    process.on('unhandledRejection', onUnhandledRejection);

    // React cleanup: app unmount (q / exit() call).
    return () => {
      restore();
      process.off('exit', restore);
      process.off('SIGINT', onSIGINT);
      process.off('SIGTERM', onSIGTERM);
      process.off('uncaughtException', onUncaughtException);
      process.off('unhandledRejection', onUnhandledRejection);
    };
  }, []);
}
