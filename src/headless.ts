import { checkOllama } from './ollama.js';
import { detectHardware } from './hardware.js';
import { sampleGpu, sampleOllamaList, sampleOllamaPs, sampleRam } from './live.js';
import { scoreHardware, tierFor, hfSearchUrl, hfSearchUrlForKeyword } from './capacity.js';
import { findInstallation, forgetInstallation, loadSettings } from './settings.js';
import { inspectInstallDir } from './reinstall.js';
import { backupDirectory, resolveBackupRoot } from './backup.js';
import { restoreBackup, readBackupManifest } from './restore.js';
import { buildEnvProfile, persistEnv, restartOllama } from './ollama.js';
import { formatBytes } from './format.js';
import { APP } from './about.js';
import { execa } from 'execa';
import { rm } from 'node:fs/promises';

function hr(label: string): void {
  const pad = '─'.repeat(Math.max(1, 70 - label.length - 4));
  console.log(`── ${label} ${pad}`);
}

export async function cmdView(): Promise<void> {
  const [hw, ollama, gpu, ram] = await Promise.all([detectHardware(), checkOllama(), sampleGpu(), sampleRam()]);
  const power = scoreHardware(hw);
  const tier = tierFor(hw);

  hr('Hardware');
  console.log(`GPU        ${hw.gpuName ?? '(no discrete GPU)'}`);
  if (hw.vramMiB > 0) console.log(`VRAM       ${formatBytes(hw.vramMiB * 1024 * 1024)}`);
  console.log(`RAM        ${formatBytes(hw.ramMiB * 1024 * 1024)}`);
  console.log(`CPU cores  ${hw.cpuCores}`);
  console.log(`Platform   ${hw.platform}`);

  if (gpu) {
    hr('Live GPU');
    console.log(`Utilization   ${gpu.utilPct ?? '—'}%`);
    console.log(`Temperature   ${gpu.tempC ?? '—'}°C`);
    console.log(`Power         ${gpu.powerW != null ? `${Math.round(gpu.powerW)} W` : '—'}`);
    console.log(`VRAM used     ${formatBytes(gpu.vramUsedMiB * 1024 * 1024)} / ${formatBytes(gpu.vramTotalMiB * 1024 * 1024)}`);
  }
  if (ram) {
    hr('Live RAM');
    console.log(`Used          ${formatBytes(ram.usedMiB * 1024 * 1024)} / ${formatBytes(ram.totalMiB * 1024 * 1024)}  (${ram.usedPct.toFixed(0)}%)`);
  }

  hr('Capacity');
  console.log(`Tier          ${tier.label}`);
  console.log(`Overall score ${power.score}/100  (GPU ${power.gpuScore} · RAM ${power.ramScore} · CPU ${power.cpuScore})`);
  console.log(`Summary       ${tier.summary}`);
  console.log('What you can run:');
  for (const r of tier.runs) {
    const prefix = r.level === 'ok' ? '  [+]' : r.level === 'warn' ? '  [!]' : '  [x]';
    console.log(`${prefix} ${r.text}`);
  }

  hr('Picks');
  for (const p of tier.picks) console.log(`  ${p.repoId.padEnd(50)} ${p.note}`);

  hr('Browse Hugging Face (pre-filtered)');
  console.log(`Trending:       ${hfSearchUrl(tier, { sort: 'trending' })}`);
  console.log(`Most downloaded:${hfSearchUrl(tier, { sort: 'downloads' })}`);
  for (const kw of tier.searchKeywords.slice(0, 3)) {
    console.log(`${kw.padEnd(15)}${hfSearchUrlForKeyword(kw)}`);
  }

  hr('Ollama');
  console.log(
    ollama.status === 'ok'
      ? `[+] ready  (${ollama.version})`
      : ollama.status === 'no-server'
        ? `[!] binary installed but server offline`
        : `[x] binary not found`,
  );
}

export async function cmdList(): Promise<void> {
  const [models, ps, settings] = await Promise.all([sampleOllamaList(), sampleOllamaPs(), loadSettings()]);
  const loadedTags = new Set(ps.map((m) => m.name));
  const registeredTags = new Set(models.map((m) => m.name));

  hr(`Installed (${models.length})`);
  if (models.length === 0) {
    console.log('  (none)');
  } else {
    for (const m of models) {
      const live = loadedTags.has(m.name) ? '[loaded]' : '[idle]';
      console.log(`  ${m.name.padEnd(40)} ${m.size.padEnd(10)} ${m.modified.padEnd(18)} ${live}`);
    }
  }

  const orphans = settings.installations.filter((i) => !registeredTags.has(i.tag));
  hr(`Available to reinstall (${orphans.length})`);
  if (orphans.length === 0) {
    console.log('  (none)');
  } else {
    for (const o of orphans) {
      const ins = await inspectInstallDir(o.dir);
      const stateLabel =
        ins.kind === 'ready' ? 'ready (Modelfile present)' :
        ins.kind === 'needs-generation' ? 'will generate Modelfile' :
        ins.kind === 'missing-gguf' ? 'no gguf in folder' :
        'folder gone';
      console.log(`  ${o.tag.padEnd(40)} ${(o.quant || '—').padEnd(10)} ${o.dir}`);
      console.log(`    -> ${stateLabel}`);
    }
  }
}

export async function cmdTune(): Promise<void> {
  const hw = await detectHardware();
  const profile = buildEnvProfile({ ramMiB: hw.ramMiB, vramMiB: hw.vramMiB, cpuCores: hw.cpuCores });
  hr('Applying Ollama env profile (~90% capacity)');
  for (const [k, v] of Object.entries(profile)) console.log(`  ${k}=${v}`);
  const results = await persistEnv(profile);
  for (const r of results) {
    const mark = r.applied ? '[+]' : '[x]';
    console.log(`  ${mark} ${r.key} via ${r.method}${r.note ? ` (${r.note})` : ''}`);
  }
  hr('Restarting Ollama so the env takes effect');
  const restart = await restartOllama();
  console.log(`  ${restart.ok ? '[+]' : '[!]'} ${restart.note}`);
}

export async function cmdBackup(tag: string): Promise<void> {
  const install = await findInstallation(tag);
  if (!install) {
    console.error(`No installation record for "${tag}". Install via hfo first or pass a known tag.`);
    process.exit(1);
  }
  const settings = await loadSettings();
  const backupsRoot = resolveBackupRoot((settings as any).backupsDir);
  hr(`Backing up ${tag}`);
  console.log(`  Source: ${install.dir}`);
  console.log(`  Target: ${backupsRoot}`);
  const result = await backupDirectory(
    { tag: install.tag, dir: install.dir, repoId: install.repoId, quant: install.quant },
    backupsRoot,
    (p) => {
      process.stdout.write(
        `\r  Packing: ${formatBytes(p.processedBytes)} / ${formatBytes(p.totalBytes)} (${p.fileCount} files)  `,
      );
    },
  );
  process.stdout.write('\n');
  const ratio = result.originalBytes > 0 ? (result.compressedBytes / result.originalBytes) * 100 : 0;
  console.log(`  [+] ${result.zipPath}`);
  console.log(`      ${formatBytes(result.compressedBytes)} (${ratio.toFixed(1)}% of original)`);
  console.log(`      manifest: ${result.metadataPath}`);
}

export async function cmdRestore(zipPath: string): Promise<void> {
  const hw = await detectHardware();
  const manifest = await readBackupManifest(zipPath);
  hr(`Restoring ${zipPath}`);
  if (manifest) {
    console.log(`  Tag:    ${manifest.tag}`);
    console.log(`  Repo:   ${manifest.repoId ?? '—'}`);
    console.log(`  Quant:  ${manifest.quant ?? '—'}`);
    console.log(`  Created: ${manifest.createdAtIso}`);
    console.log(`  Source: ${manifest.sourceDir}`);
  } else {
    console.log('  (no manifest found in zip or next to it — will extract blindly)');
  }
  const result = await restoreBackup(zipPath, hw);
  console.log(`  [+] Extracted to ${result.restoredTo}`);
  console.log(`  [+] Registered as ${result.tag}${result.modelfileGenerated ? ' (Modelfile synthesized)' : ''}`);
}

export async function cmdDelete(tag: string, opts: { deep?: boolean }): Promise<void> {
  hr(`Removing ${tag}${opts.deep ? ' + directory' : ''}`);
  try {
    await execa('ollama', ['rm', tag]);
    console.log(`  [+] ollama rm ${tag}`);
  } catch (err) {
    console.error(`  [x] ollama rm failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }
  if (opts.deep) {
    const install = await findInstallation(tag);
    if (install) {
      try {
        await rm(install.dir, { recursive: true, force: true });
        console.log(`  [+] removed directory ${install.dir}`);
      } catch (err) {
        console.error(`  [!] could not remove ${install.dir}: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      console.log(`  [!] no installation record for ${tag} — nothing on disk to remove`);
    }
  }
  await forgetInstallation(tag);
}

export function cmdVersion(): void {
  console.log(`${APP.binary} v${APP.version}`);
  console.log(`${APP.license} · ${APP.author.name} · ${APP.author.url ?? APP.homepage}`);
}
