import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * cmdDelete stringifies a non-Error rejection from `rm`. The filesystem never
 * rejects with anything but an Error, so the only honest way to reach that arm
 * is to make the module's `rm` do it.
 */
const rm = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>();
  return { ...actual, rm, default: { ...actual, rm } };
});

const execa = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa }));

const findInstallation = vi.hoisted(() => vi.fn());
const forgetInstallation = vi.hoisted(() => vi.fn());
const loadSettings = vi.hoisted(() => vi.fn());
vi.mock('../src/infra/settings.js', async (orig) => {
  const actual = await orig<typeof import('../src/infra/settings.js')>();
  return { ...actual, findInstallation, forgetInstallation, loadSettings };
});

import { cmdDelete } from '../src/headless.js';

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  rm.mockReset();
  execa.mockReset().mockResolvedValue({ stdout: '' });
  findInstallation.mockReset();
  forgetInstallation.mockReset().mockResolvedValue(undefined);
  loadSettings.mockReset().mockResolvedValue({ language: 'en', installations: [] });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('cmdDelete — deep delete failure reporting', () => {
  it('stringifies a non-Error rejection from rm', async () => {
    findInstallation.mockResolvedValue({
      tag: 'd:q4', dir: '/m/d', repoId: 'o/r', quant: 'Q4', installedAt: '',
    });
    rm.mockRejectedValue('a bare string, not an Error');

    await cmdDelete('d:q4', { deep: true });

    expect(err.join('\n')).toContain('could not remove /m/d: a bare string, not an Error');
    // The tag record is still forgotten even though the files could not go.
    expect(forgetInstallation).toHaveBeenCalledWith('d:q4');
  });

  it('reports an Error rejection by its message', async () => {
    findInstallation.mockResolvedValue({
      tag: 'd:q4', dir: '/m/d', repoId: 'o/r', quant: 'Q4', installedAt: '',
    });
    rm.mockRejectedValue(new Error('EBUSY: resource busy'));

    await cmdDelete('d:q4', { deep: true });
    expect(err.join('\n')).toContain('could not remove /m/d: EBUSY: resource busy');
  });

  it('confirms the removal when rm succeeds', async () => {
    findInstallation.mockResolvedValue({
      tag: 'd:q4', dir: '/m/d', repoId: 'o/r', quant: 'Q4', installedAt: '',
    });
    rm.mockResolvedValue(undefined);

    await cmdDelete('d:q4', { deep: true });
    expect(out.join('\n')).toContain('removed directory /m/d');
    expect(rm).toHaveBeenCalledWith('/m/d', { recursive: true, force: true });
  });
});
