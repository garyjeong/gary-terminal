import { useEffect } from 'react';
import * as si from 'systeminformation';
import { useStore } from '../store.js';

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

        // Network: sum across all interfaces (rx_sec/tx_sec are bytes/sec)
        const rxBytes = nets.reduce((s, n) => s + Math.max(0, n.rx_sec ?? 0), 0);
        const txBytes = nets.reduce((s, n) => s + Math.max(0, n.tx_sec ?? 0), 0);
        const net = { rxKBs: rxBytes / 1024, txKBs: txBytes / 1024 };

        // Disk: prefer root mount, fallback to first entry
        const mainFs = fsSizes.find((f) => f.mount === '/') ?? fsSizes[0];
        const disk = mainFs && mainFs.size > 0
          ? { usedPct: Math.round((mainFs.used / mainFs.size) * 100) }
          : { usedPct: 0 };

        updateSystemStats(cpu, memPercent, net, disk);
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
