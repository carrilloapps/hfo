import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { basename, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { fetchRepoInfo, parseRepoId, type HfRepoInfo } from './hf.js';
import { detectHardware, type HardwareProfile } from './hardware.js';
import { checkOllama, ollamaList, restartOllama, type InstallStatus } from './ollama.js';
import { scoreRepo, type QuantScore, type RepoScore } from './scoring.js';
import { loadCardParams, type CardInfo } from './readme.js';
import { buildDefaultParams, buildPlans, type PlannedInstall, type ResolvedParams } from './plan.js';
import { suggestTag } from './modelfile.js';
import { icon } from './icons.js';
import HardwareReport from './components/HardwareReport.js';
import MultiQuantPicker from './components/MultiQuantPicker.js';
import FileBrowser from './components/FileBrowser.js';
import Processor, { type InstalledModel } from './components/Processor.js';
import LaunchPrompt from './components/LaunchPrompt.js';
import OllamaInstaller from './components/OllamaInstaller.js';
import OllamaTuner from './components/OllamaTuner.js';
import PlanReviewer from './components/PlanReviewer.js';
import ParamsEditor from './components/ParamsEditor.js';
import QuickConfirm, { type QuickAction } from './components/QuickConfirm.js';
import { getTheme } from './theme.js';

type Phase =
  | { kind: 'probing' }
  | { kind: 'ollama-missing'; status: InstallStatus }
  | { kind: 'offer-tune'; hw: HardwareProfile; repoId: string }
  | { kind: 'loading-repo'; hw: HardwareProfile; repoId: string }
  | { kind: 'scored'; repo: HfRepoInfo; hw: HardwareProfile; score: RepoScore; card: CardInfo }
  | { kind: 'quants-picked'; repo: HfRepoInfo; hw: HardwareProfile; card: CardInfo; picked: QuantScore[] }
  | {
      kind: 'quick-confirm';
      repo: HfRepoInfo;
      hw: HardwareProfile;
      card: CardInfo;
      quant: QuantScore;
      destDir: string;
      tag: string;
    }
  | { kind: 'change-dir'; repo: HfRepoInfo; hw: HardwareProfile; card: CardInfo; quant: QuantScore }
  | { kind: 'building-plans'; repo: HfRepoInfo; hw: HardwareProfile; card: CardInfo; picked: QuantScore[]; destDir: string }
  | {
      kind: 'reviewing';
      repo: HfRepoInfo;
      hw: HardwareProfile;
      card: CardInfo;
      plans: PlannedInstall[];
      existingTags: Set<string>;
    }
  | {
      kind: 'params-editing';
      repo: HfRepoInfo;
      hw: HardwareProfile;
      card: CardInfo;
      plans: PlannedInstall[];
      params: ResolvedParams;
    }
  | {
      kind: 'processing';
      repo: HfRepoInfo;
      hw: HardwareProfile;
      card: CardInfo;
      plans: PlannedInstall[];
      params: ResolvedParams;
    }
  | { kind: 'installed'; installed: InstalledModel[] }
  | { kind: 'done'; installed: InstalledModel[]; launchedTag: string | null }
  | { kind: 'error'; message: string };

interface Props {
  input: string;
  baseDir: string;
  token?: string;
  codeModel: boolean;
  contextSize?: number;
  skipTune: boolean;
  embedded?: boolean;
  onComplete: (launchTag: string | null) => void;
}

function repoSlugFolder(repoId: string): string {
  return repoId
    .split('/')
    .pop()!
    .toLowerCase()
    .replace(/\.(gguf|ggml|safetensors)$/i, '')
    .replace(/[-_. ](gguf|ggml|imatrix|quants?|quantized)$/gi, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function detectConflicts(
  destDir: string,
  tag: string,
): Promise<{ tagExists: boolean; dirExists: boolean }> {
  const [tags, dirExists] = await Promise.all([
    ollamaList().then((list) => new Set(list)),
    stat(destDir).then(() => true).catch(() => false),
  ]);
  return { tagExists: tags.has(tag), dirExists };
}

export default function App(props: Props) {
  const { input, baseDir, token, codeModel, contextSize, skipTune, embedded, onComplete } = props;
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>({ kind: 'probing' });
  const [hwCache, setHwCache] = useState<HardwareProfile | null>(null);
  const theme = getTheme('dark');

  useEffect(() => {
    (async () => {
      try {
        const repoId = parseRepoId(input);
        const [ollamaSt, hw] = await Promise.all([checkOllama(), detectHardware()]);
        setHwCache(hw);
        if (ollamaSt.status !== 'ok') {
          setPhase({ kind: 'ollama-missing', status: ollamaSt.status });
          return;
        }
        if (skipTune) setPhase({ kind: 'loading-repo', hw, repoId });
        else setPhase({ kind: 'offer-tune', hw, repoId });
      } catch (err) {
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [input]);

  useEffect(() => {
    if (phase.kind !== 'loading-repo') return;
    (async () => {
      try {
        const [repo, card] = await Promise.all([
          fetchRepoInfo(phase.repoId, token),
          loadCardParams(phase.repoId, token),
        ]);
        const ggufs = repo.ggufFiles.filter((f) => !/mmproj|projector/i.test(f.path));
        if (ggufs.length === 0) {
          setPhase({ kind: 'error', message: `No runnable .gguf files in repo "${phase.repoId}".` });
          return;
        }
        const score = scoreRepo(ggufs, phase.hw);
        setPhase({ kind: 'scored', repo: { ...repo, ggufFiles: ggufs }, hw: phase.hw, score, card });
      } catch (err) {
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [phase.kind]);

  // After the user commits their quant pick, decide whether to take the fast
  // path (single quant, no conflicts) or fall into the detailed review flow.
  useEffect(() => {
    if (phase.kind !== 'quants-picked') return;
    (async () => {
      try {
        const { repo, hw, card, picked } = phase;
        const destRoot = join(baseDir, repoSlugFolder(repo.id));
        if (picked.length === 1) {
          const quant = picked[0];
          const tag = suggestTag(repo.id, quant.quant);
          const quantFolder = quant.quant.toLowerCase().replace(/_/g, '-');
          const destDir = join(destRoot, quantFolder);
          const conflicts = await detectConflicts(destDir, tag);
          if (!conflicts.tagExists && !conflicts.dirExists) {
            setPhase({ kind: 'quick-confirm', repo, hw, card, quant, destDir, tag });
            return;
          }
        }
        setPhase({
          kind: 'building-plans',
          repo,
          hw,
          card,
          picked,
          destDir: destRoot,
        });
      } catch (err) {
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [phase.kind]);

  useEffect(() => {
    if (phase.kind !== 'building-plans') return;
    (async () => {
      try {
        const plans = await buildPlans(phase.repo, phase.picked, phase.destDir);
        const existing = new Set(await ollamaList());
        setPhase({
          kind: 'reviewing',
          repo: phase.repo,
          hw: phase.hw,
          card: phase.card,
          plans,
          existingTags: existing,
        });
      } catch (err) {
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [phase.kind]);

  useEffect(() => {
    if (phase.kind === 'done' || phase.kind === 'error') {
      const launchTag = phase.kind === 'done' ? phase.launchedTag : null;
      onComplete(launchTag);
      if (!embedded) {
        const timer = setTimeout(() => exit(), 80);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [phase.kind]);

  if (phase.kind === 'probing') {
    return (
      <Box>
        <Text color={theme.primary as any}>
          <Spinner type="dots" /> Probing Ollama and detecting hardware...
        </Text>
      </Box>
    );
  }

  if (phase.kind === 'error') {
    return (
      <Box flexDirection="column">
        <Text color={theme.danger as any}>{icon.cross} {phase.message}</Text>
      </Box>
    );
  }

  if (phase.kind === 'ollama-missing') {
    const repoId = parseRepoId(input);
    return (
      <OllamaInstaller
        missing={phase.status as 'no-binary' | 'no-server'}
        onReady={() => {
          const hw = hwCache!;
          setPhase(skipTune ? { kind: 'loading-repo', hw, repoId } : { kind: 'offer-tune', hw, repoId });
        }}
        onSkip={() => setPhase({ kind: 'error', message: 'Cannot continue without a running Ollama.' })}
        onRestartOllama={async () => {
          await restartOllama();
        }}
      />
    );
  }

  if (phase.kind === 'offer-tune') {
    const { hw, repoId } = phase;
    return (
      <OllamaTuner
        hw={hw}
        onDone={() => setPhase({ kind: 'loading-repo', hw, repoId })}
        onSkip={() => setPhase({ kind: 'loading-repo', hw, repoId })}
      />
    );
  }

  if (phase.kind === 'loading-repo') {
    return (
      <Box>
        <Text color={theme.primary as any}>
          <Spinner type="dots" /> Fetching HuggingFace repo metadata + README, scoring compatibility...
        </Text>
      </Box>
    );
  }

  if (phase.kind === 'scored') {
    const { repo, hw, score, card } = phase;
    return (
      <Box flexDirection="column">
        <HardwareReport hw={hw} repoId={repo.id} repoScore={score.best} avgScore={score.avg} quantCount={score.perQuant.length} />
        {card.foundKeys.length > 0 && (
          <Box marginTop={1}>
            <Text color={theme.success as any}>{icon.star} HF model card contributed recommendations for: {card.foundKeys.join(', ')}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <MultiQuantPicker
            items={score.perQuant}
            onConfirm={(picked) => setPhase({ kind: 'quants-picked', repo, hw, card, picked })}
          />
        </Box>
      </Box>
    );
  }

  if (phase.kind === 'quants-picked') {
    return (
      <Box>
        <Text color={theme.primary as any}>
          <Spinner type="dots" /> Scanning for existing tags / cached files...
        </Text>
      </Box>
    );
  }

  if (phase.kind === 'quick-confirm') {
    const { repo, hw, card, quant, destDir, tag } = phase;
    const handleChoice = (action: QuickAction) => {
      if (action === 'cancel') {
        setPhase({ kind: 'scored', repo, hw, score: { best: 0, worst: 0, avg: 0, perQuant: [quant] }, card });
        return;
      }
      if (action === 'change-dir') {
        setPhase({ kind: 'change-dir', repo, hw, card, quant });
        return;
      }

      const params = buildDefaultParams(quant, hw, card.params, codeModel);
      if (contextSize) params.numCtx = contextSize;

      const quantFolder = quant.quant.toLowerCase().replace(/_/g, '-');
      const planDir = destDir;
      const plan: PlannedInstall = {
        quant,
        tag,
        dir: planDir,
        modelfilePath: join(planDir, 'Modelfile'),
        destFile: join(planDir, basename(quant.file.path)),
        action: 'install',
        fileExistsBytes: null,
        tagExists: false,
      };

      if (action === 'customize') {
        setPhase({ kind: 'params-editing', repo, hw, card, plans: [plan], params });
      } else {
        // install-now
        setPhase({ kind: 'processing', repo, hw, card, plans: [plan], params });
      }
    };
    return (
      <QuickConfirm
        theme={theme}
        quant={quant}
        repoId={repo.id}
        suggestedTag={tag}
        suggestedDir={destDir}
        card={card}
        hasConflicts={false}
        onChoose={handleChoice}
      />
    );
  }

  if (phase.kind === 'change-dir') {
    const { repo, hw, card, quant } = phase;
    const suggestedFolder = repoSlugFolder(repo.id);
    return (
      <Box flexDirection="column">
        <Text bold>Pick where to install {quant.quant}:</Text>
        <Box marginTop={1}>
          <FileBrowser
            initialPath={baseDir}
            defaultFolderName={suggestedFolder}
            onSelect={(chosen) => {
              const tag = suggestTag(repo.id, quant.quant);
              const quantFolder = quant.quant.toLowerCase().replace(/_/g, '-');
              const destDir = join(chosen, quantFolder);
              setPhase({ kind: 'quick-confirm', repo, hw, card, quant, destDir, tag });
            }}
            onCancel={() => setPhase({ kind: 'scored', repo, hw, score: { best: 0, worst: 0, avg: 0, perQuant: [quant] }, card })}
          />
        </Box>
      </Box>
    );
  }

  if (phase.kind === 'building-plans') {
    return (
      <Box>
        <Text color={theme.primary as any}>
          <Spinner type="dots" /> Scanning for existing tags / cached files...
        </Text>
      </Box>
    );
  }

  if (phase.kind === 'reviewing') {
    const { repo, hw, card, plans, existingTags } = phase;
    return (
      <PlanReviewer
        initialPlans={plans}
        existingTags={existingTags}
        onConfirm={(resolved) => {
          const actionable = resolved.filter((p) => p.action !== 'skip');
          if (actionable.length === 0) {
            setPhase({ kind: 'error', message: 'All items were skipped.' });
            return;
          }
          const ref = actionable[0].quant;
          const params = buildDefaultParams(ref, hw, card.params, codeModel);
          if (contextSize) params.numCtx = contextSize;
          setPhase({ kind: 'processing', repo, hw, card, plans: resolved, params });
        }}
        onCancel={() => setPhase({ kind: 'error', message: 'Cancelled by user.' })}
      />
    );
  }

  if (phase.kind === 'params-editing') {
    const { repo, hw, card, plans, params } = phase;
    return (
      <ParamsEditor
        params={params}
        cardKeys={card.foundKeys}
        onConfirm={(next) => setPhase({ kind: 'processing', repo, hw, card, plans, params: next })}
        onSkip={() => setPhase({ kind: 'processing', repo, hw, card, plans, params })}
      />
    );
  }

  if (phase.kind === 'processing') {
    const { repo, hw, plans, params } = phase;
    return (
      <Processor
        repo={repo}
        hw={hw}
        plans={plans}
        paramsFor={() => params}
        cardKeysFor={() => phase.card.foundKeys}
        token={token}
        codeModel={codeModel}
        onDone={(installed) => setPhase({ kind: 'installed', installed })}
        onError={(err) => setPhase({ kind: 'error', message: err.message })}
      />
    );
  }

  if (phase.kind === 'installed') {
    const { installed } = phase;
    const actionable = installed.filter((m) => !m.skipped);
    if (actionable.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color={theme.warning as any}>All items were skipped — nothing to launch.</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Text color={theme.success as any} bold>{icon.tick} Install complete.</Text>
        <Box flexDirection="column" marginY={1}>
          {installed.map((m) => (
            <Text key={m.tag} color={m.skipped ? (theme.muted as any) : undefined}>
              {m.skipped ? `${icon.cross} ` : `${icon.bullet} `}
              <Text color={theme.primary as any}>{m.tag}</Text> <Text color={theme.muted as any}>({m.quant}, score {m.score}/100)</Text>
              {m.reusedFile && <Text color={theme.success as any}> · file reused</Text>}
              {m.skipped && <Text color={theme.muted as any}> · skipped</Text>}
            </Text>
          ))}
        </Box>
        <LaunchPrompt
          installed={actionable}
          onChoose={(tag) => setPhase({ kind: 'done', installed, launchedTag: tag })}
        />
      </Box>
    );
  }

  if (phase.kind === 'done') {
    const { installed, launchedTag } = phase;
    return (
      <Box flexDirection="column">
        <Text color={theme.success as any} bold>{icon.tick} Done.</Text>
        {installed.map((m) => (
          <Text key={m.tag} color={theme.muted as any}>{icon.bullet} {m.tag} at {m.dir}</Text>
        ))}
        {launchedTag ? (
          <Text>Handing off to: <Text color={theme.primary as any}>ollama run {launchedTag}</Text></Text>
        ) : (
          <Text color={theme.muted as any}>(Skipped launch. Use `ollama run &lt;tag&gt;` when ready.)</Text>
        )}
      </Box>
    );
  }

  return null;
}
