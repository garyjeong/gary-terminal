import { useEffect } from 'react';
import * as si from 'systeminformation';
import { useStore } from '../store.js';

export function useSystemStats(): void {
  const updateSystemStats = useStore((state) => state.updateSystemStats);

  useEffect(() => {
    let active = true;

    async function poll(): Promise<void> {
      try {
        const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
        if (!active) return;
        const cpu = Math.round(load.currentLoad);
        const memPercent = Math.round((mem.used / mem.total) * 100);
        updateSystemStats(cpu, memPercent);
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
