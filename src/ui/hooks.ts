import { useEffect, useRef, useState } from 'react';

export function useTerminalSize(): { cols: number; rows: number } {
  const [size, setSize] = useState({
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  });
  useEffect(() => {
    const onResize = () =>
      setSize({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);
  return size;
}

export function useInterval(callback: () => void, ms: number | null): void {
  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (ms == null) return;
    const id = setInterval(() => savedCallback.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useNow(ms: number): Date {
  const [now, setNow] = useState(new Date());
  useInterval(() => setNow(new Date()), ms);
  return now;
}
