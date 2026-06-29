import { useEffect } from 'react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as si from 'systeminformation';
import { useStore } from '../store.js';
import type { DetectedServer } from '../types.js';

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

/**
 * Get a map of PID → listening TCP ports via `lsof -nP -iTCP -sTCP:LISTEN -F pn`.
 * Returns empty map on any error.
 */
export async function getListeningPidPorts(): Promise<Map<number, number[]>> {
  const pidPorts = new Map<number, number[]>();
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn',
    ]);
    let currentPid: number | null = null;
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed[0] === 'p') {
        const parsed = parseInt(trimmed.slice(1), 10);
        currentPid = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      } else if (trimmed[0] === 'n' && currentPid !== null) {
        // e.g. "*:3000", "127.0.0.1:3000", "[::]:8080"
        const portMatch = trimmed.match(/:(\d+)$/);
        if (portMatch) {
          const port = parseInt(portMatch[1]!, 10);
          if (!pidPorts.has(currentPid)) pidPorts.set(currentPid, []);
          pidPorts.get(currentPid)!.push(port);
        }
      }
      // 'f' lines (file descriptor separators) are silently ignored
    }
  } catch {
    // lsof unavailable or permission denied
  }
  return pidPorts;
}

/**
 * Get the cwd of a process via `lsof -a -p <pid> -d cwd -Fn`.
 * Returns null on any error (process not found, permission denied, etc.).
 */
export async function getPidCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-a', '-p', String(pid), '-d', 'cwd', '-Fn',
    ]);
    const nLine = stdout.split('\n').find((l) => l.trim().startsWith('n'));
    if (!nLine) return null;
    const path = nLine.trim().slice(1);
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Detect servers running inside the repo root (repoRoot) and return their info.
 * Excludes the process identified by ownPid.
 */
export async function detectRepoServers(
  repoRoot: string,
  ownPid: number,
): Promise<Array<{ pid: number; ports: number[] }>> {
  const pidPortMap = await getListeningPidPorts();
  const candidates = [...pidPortMap.entries()].filter(([pid]) => pid !== ownPid);
  if (candidates.length === 0) return [];

  // Check cwds in parallel — processes may die between steps, handled gracefully
  const cwdResults = await Promise.all(
    candidates.map(async ([pid, ports]) => {
      const cwd = await getPidCwd(pid);
      return { pid, ports, cwd };
    }),
  );

  return cwdResults
    .filter(({ cwd }) => cwd !== null && cwd.startsWith(repoRoot))
    .map(({ pid, ports }) => ({ pid, ports }));
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

        // ── Auto-detect repo servers ──────────────────────────────────────
        const repoRoot = process.cwd();
        const ownPid = process.pid;
        const prevDetected = useStore.getState().detectedServers;

        try {
          const repoEntries = await detectRepoServers(repoRoot, ownPid);
          if (!active) return;

          if (repoEntries.length > 0) {
            // Get process stats for the detected servers
            const procsData = await si.processes();
            if (!active) return;
            const procMap = new Map(procsData.list.map((p) => [p.pid, p]));

            const existingMap = new Map(prevDetected.map((s) => [s.pid, s]));
            const HIST = 20;

            const newServers: DetectedServer[] = repoEntries.map(({ pid, ports }) => {
              const proc = procMap.get(pid);
              const cpu = proc ? Math.round(proc.cpu * 10) / 10 : 0;
              const mem = proc ? Math.round(proc.mem * 10) / 10 : 0;
              const memRssMB = proc ? ((proc.memRss ?? 0) as number) / (1024 * 1024) : 0;
              const name = proc?.name ?? `pid:${pid}`;
              const prev = existingMap.get(pid);
              const cpuHistory = prev
                ? (prev.cpuHistory.length >= HIST
                  ? [...prev.cpuHistory.slice(-(HIST - 1)), cpu]
                  : [...prev.cpuHistory, cpu])
                : [cpu];
              return {
                pid,
                name,
                port: ports[0] ?? 0,
                cpu,
                mem,
                memRssMB,
                cpuHistory,
              };
            });

            useStore.getState().setDetectedServers(newServers);
          } else if (prevDetected.length > 0) {
            // Servers have stopped — clear the list
            useStore.getState().setDetectedServers([]);
          }
        } catch {
          // ignore server detection errors
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
