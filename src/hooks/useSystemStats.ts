import { useEffect } from 'react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as si from 'systeminformation';
import { useStore } from '../store.js';

const execFileAsync = promisify(execFile);

/**
 * Resolve a TCP-LISTEN port to its PID via `lsof`.
 * Returns null on any error (port not bound, lsof not available, etc.).
 */
async function portToPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('lsof', [
      `-i:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ]);
    const pid = parseInt(stdout.trim().split('\n')[0] ?? '', 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function useSystemStats(): void {
  const updateSystemStats = useStore((state) => state.updateSystemStats);

  useEffect(() => {
    let active = true;

    async function poll(): Promise<void> {
      // Skip polling while copy-mode is active to prevent re-renders that would
      // corrupt the static conversation dump in the main screen buffer.
      if (useStore.getState().ui.copyMode) return;
      try {
        const [load, mem, nets, fsSizes] = await Promise.all([
          si.currentLoad(),
          si.mem(),
          si.networkStats(),
          si.fsSize(),
        ]);
        if (!active) return;

        const cpu = Math.round(load.currentLoad);
        const memPercent = Math.round((mem.used / mem.total) * 100);
        const memTotalGB = mem.total / (1024 * 1024 * 1024);

        // Network: sum across all interfaces (rx_sec/tx_sec are bytes/sec)
        const rxBytes = nets.reduce((s, n) => s + Math.max(0, n.rx_sec ?? 0), 0);
        const txBytes = nets.reduce((s, n) => s + Math.max(0, n.tx_sec ?? 0), 0);
        const net = { rxKBs: rxBytes / 1024, txKBs: txBytes / 1024 };

        // Disk: prefer root mount, fallback to first entry
        const mainFs = fsSizes.find((f) => f.mount === '/') ?? fsSizes[0];
        const disk = mainFs && mainFs.size > 0
          ? { usedPct: Math.round((mainFs.used / mainFs.size) * 100) }
          : { usedPct: 0 };

        updateSystemStats(cpu, memPercent, net, disk, memTotalGB);

        // ── Bound process stats update ────────────────────────────────────
        const boundProcesses = useStore.getState().boundProcesses;
        if (boundProcesses.length > 0) {
          // Only call si.processes() when there are bound processes to check.
          const procsData = await si.processes();
          if (!active) return;

          const procMap = new Map(procsData.list.map((p) => [p.pid, p]));
          const store = useStore.getState();

          for (const bp of boundProcesses) {
            let resolvedPid = bp.pid;

            // Re-resolve port→PID if dead or never resolved
            if (bp.bindType === 'port' && (resolvedPid === null || !bp.alive)) {
              resolvedPid = await portToPid(parseInt(bp.bindValue, 10));
            }

            if (resolvedPid !== null) {
              const proc = procMap.get(resolvedPid);
              if (proc) {
                store.updateBoundProcessStats(
                  bp.id,
                  resolvedPid,
                  Math.round(proc.cpu * 10) / 10,
                  Math.round(proc.mem * 10) / 10,
                  (proc.memRss ?? 0) / (1024 * 1024),
                  proc.name,
                  true,
                );
              } else {
                store.updateBoundProcessStats(bp.id, resolvedPid, 0, 0, 0, bp.name, false);
              }
            } else {
              store.updateBoundProcessStats(bp.id, null, 0, 0, 0, bp.name, false);
            }
          }
        }
      } catch {
        // ignore polling errors
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), 2500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [updateSystemStats]);
}
