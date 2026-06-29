import { useState, useEffect } from 'react';

export function useTerminalSize(): { columns: number; rows: number } {
  const [columns, setColumns] = useState(
    process.stdout.columns ?? 80
  );
  const [rows, setRows] = useState(
    process.stdout.rows ?? 24
  );

  useEffect(() => {
    const handler = () => {
      setColumns(process.stdout.columns ?? 80);
      setRows(process.stdout.rows ?? 24);
    };
    process.stdout.on('resize', handler);
    return () => {
      process.stdout.off('resize', handler);
    };
  }, []);

  return {
    columns: Math.max(columns ?? 60, 60),
    rows: Math.max(rows ?? 15, 15),
  };
}
