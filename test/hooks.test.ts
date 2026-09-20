import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink';
import { Text } from 'ink';
import { useTerminalSize, useInterval, useNow } from '../src/ui/hooks.js';

/**
 * These are React hooks, so they need a renderer to exercise. Ink is already a
 * dependency and runs headless against a stub stream, which keeps the test in
 * the plain node environment the rest of the suite uses — no jsdom, no extra
 * testing library.
 */
function mountHook<T>(useHook: () => T): { latest: () => T; unmount: () => void } {
  let latest!: T;
  function Probe() {
    latest = useHook();
    return React.createElement(Text, null, 'probe');
  }
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {},
    read: () => null, ref() {}, unref() {},
  });
  const stdout = Object.assign(new EventEmitter(), {
    isTTY: true, columns: 120, rows: 40, write: () => true,
  });
  const app = render(React.createElement(Probe), {
    stdin: stdin as never,
    stdout: stdout as never,
    stderr: stdout as never,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  return { latest: () => latest, unmount: () => app.unmount() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('useTerminalSize', () => {
  const realCols = process.stdout.columns;
  const realRows = process.stdout.rows;

  afterEach(() => {
    process.stdout.columns = realCols;
    process.stdout.rows = realRows;
    process.stdout.removeAllListeners('resize');
  });

  it('reports the current terminal dimensions', async () => {
    process.stdout.columns = 100;
    process.stdout.rows = 30;
    const h = mountHook(() => useTerminalSize());
    await tick();
    expect(h.latest()).toEqual({ cols: 100, rows: 30 });
    h.unmount();
  });

  it('falls back to 80x24 when the stream reports no size', async () => {
    process.stdout.columns = undefined as unknown as number;
    process.stdout.rows = undefined as unknown as number;
    const h = mountHook(() => useTerminalSize());
    await tick();
    expect(h.latest()).toEqual({ cols: 80, rows: 24 });
    h.unmount();
  });

  it('updates when the terminal emits a resize', async () => {
    process.stdout.columns = 100;
    process.stdout.rows = 30;
    const h = mountHook(() => useTerminalSize());
    await tick();
    process.stdout.columns = 140;
    process.stdout.rows = 50;
    process.stdout.emit('resize');
    await tick();
    expect(h.latest()).toEqual({ cols: 140, rows: 50 });
    h.unmount();
  });

  it('uses the fallback when a resize reports no size', async () => {
    const h = mountHook(() => useTerminalSize());
    await tick();
    process.stdout.columns = undefined as unknown as number;
    process.stdout.rows = undefined as unknown as number;
    process.stdout.emit('resize');
    await tick();
    expect(h.latest()).toEqual({ cols: 80, rows: 24 });
    h.unmount();
  });

  it('detaches its resize listener on unmount', async () => {
    const before = process.stdout.listenerCount('resize');
    const h = mountHook(() => useTerminalSize());
    await tick();
    expect(process.stdout.listenerCount('resize')).toBe(before + 1);
    h.unmount();
    await tick();
    expect(process.stdout.listenerCount('resize')).toBe(before);
  });
});

describe('useInterval', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('invokes the callback on each tick', async () => {
    const spy = vi.fn();
    const h = mountHook(() => useInterval(spy, 100));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(350);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
    h.unmount();
  });

  it('never schedules anything when the delay is null', async () => {
    const spy = vi.fn();
    const h = mountHook(() => useInterval(spy, null));
    await vi.advanceTimersByTimeAsync(1000);
    expect(spy).not.toHaveBeenCalled();
    h.unmount();
  });

  it('stops firing after unmount', async () => {
    const spy = vi.fn();
    const h = mountHook(() => useInterval(spy, 50));
    await vi.advanceTimersByTimeAsync(120);
    h.unmount();
    await vi.advanceTimersByTimeAsync(0);
    const after = spy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(spy.mock.calls.length).toBe(after);
  });

  it('calls the latest callback without restarting the timer', async () => {
    const first = vi.fn();
    const second = vi.fn();
    let current = first;
    const h = mountHook(() => useInterval(() => current(), 50));
    await vi.advanceTimersByTimeAsync(60);
    expect(first).toHaveBeenCalled();
    current = second;
    await vi.advanceTimersByTimeAsync(60);
    expect(second).toHaveBeenCalled();
    h.unmount();
  });
});

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns a Date immediately', async () => {
    const h = mountHook(() => useNow(1000));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.latest()).toBeInstanceOf(Date);
    h.unmount();
  });

  it('advances as the interval fires', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const h = mountHook(() => useNow(1000));
    await vi.advanceTimersByTimeAsync(0);
    const first = h.latest().getTime();

    // Advancing fake timers moves the clock and fires the interval, but the
    // resulting setState still has to be flushed by the reconciler before the
    // probe sees it — so give it a few turns rather than reading immediately.
    for (let i = 0; i < 5 && h.latest().getTime() === first; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }
    expect(h.latest().getTime()).toBeGreaterThan(first);
    h.unmount();
  });
});
