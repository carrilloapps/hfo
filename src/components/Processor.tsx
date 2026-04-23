import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { mkdir, rm } from 'node:fs/promises';
import type { HardwareProfile } from '../hardware.js';
import type { HfRepoInfo } from '../hf.js';
import { downloadFile, fileDownloadUrl } from '../hf.js';
import type { PlannedInstall, ResolvedParams } from '../plan.js';
import { buildModelfile, writeModelfile } from '../modelfile.js';
import { ollamaCreate } from '../ollama.js';
import { formatBytes, formatEta, formatRate, progressBar } from '../format.js';
import { icon } from '../icons.js';
import { recordInstallation } from '../settings.js';

export interface InstalledModel {
  tag: string;
  quant: string;
  score: number;
  dir: string;
  modelfilePath: string;
  reusedFile: boolean;
  skipped: boolean;
}

interface Props {
  repo: HfRepoInfo;
  hw: HardwareProfile;
  plans: PlannedInstall[];
  paramsFor: (plan: PlannedInstall) => ResolvedParams;
  cardKeysFor: (plan: PlannedInstall) => string[];
  token?: string;
  codeModel: boolean;
  onDone: (installed: InstalledModel[]) => void;
  onError: (err: Error) => void;
}

type Step = 'idle' | 'downloading' | 'reusing' | 'writing-modelfile' | 'creating-ollama' | 'done' | 'error';

export default function Processor(props: Props) {
  const { repo, hw, plans, paramsFor, cardKeysFor, token, codeModel, onDone, onError } = props;
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState<Step>('idle');
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);

  useEffect(() => {
    if (idx >= plans.length) {
      onDone(installed);
      return;
    }
    let cancelled = false;
    const plan = plans[idx];

    if (plan.action === 'skip') {
      setInstalled((prev) => [
        ...prev,
        {
          tag: plan.tag,
          quant: plan.quant.quant,
          score: plan.quant.score,
          dir: plan.dir,
          modelfilePath: plan.modelfilePath,
          reusedFile: false,
          skipped: true,
        },
      ]);
      setIdx((i) => i + 1);
      return;
    }

    (async () => {
      try {
        await mkdir(plan.dir, { recursive: true });
        const url = fileDownloadUrl(repo.id, plan.quant.file.path);

        const reuseFile = plan.fileExistsBytes != null && plan.fileExistsBytes === plan.quant.file.size;

        if (plan.action === 'overwrite' && plan.fileExistsBytes != null && !reuseFile) {
          // start from scratch when user explicitly wants overwrite and local file is partial/corrupt
          try {
            await rm(plan.destFile);
          } catch {}
        }

        if (!reuseFile) {
          setStep('downloading');
          setReceived(0);
          setTotal(0);
          setStartTime(Date.now());
          await downloadFile(url, plan.destFile, token, (b, t) => {
            if (!cancelled) {
              setReceived(b);
              setTotal(t);
            }
          });
          if (cancelled) return;
        } else {
          setStep('reusing');
        }

        setStep('writing-modelfile');
        const params = paramsFor(plan);
        const cardKeys = cardKeysFor(plan);
        const content = buildModelfile({
          ggufFilename: plan.quant.file.path.split('/').pop()!,
          repoId: repo.id,
          quant: plan.quant.quant,
          hw,
          params,
          cardSource: cardKeys,
          isCodeModel: codeModel,
          scoreLabel: `${plan.quant.score}/100 (${plan.quant.label})`,
        });
        await writeModelfile(plan.modelfilePath, content);

        setStep('creating-ollama');
        await ollamaCreate(plan.tag, plan.modelfilePath, plan.dir);

        // Persist the tag -> dir mapping so the Models tab can offer a deep
        // delete (Alt+D) later. Failure here is non-fatal — worst case we fall
        // back to a shallow delete with a warning.
        try {
          await recordInstallation({
            tag: plan.tag,
            dir: plan.dir,
            repoId: repo.id,
            quant: plan.quant.quant,
          });
        } catch {
          /* non-fatal */
        }

        setInstalled((prev) => [
          ...prev,
          {
            tag: plan.tag,
            quant: plan.quant.quant,
            score: plan.quant.score,
            dir: plan.dir,
            modelfilePath: plan.modelfilePath,
            reusedFile: reuseFile,
            skipped: false,
          },
        ]);
        setIdx((i) => i + 1);
      } catch (err) {
        if (!cancelled) {
          setStep('error');
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idx]);

  if (idx >= plans.length) {
    return (
      <Box>
        <Text color="green">{icon.tick} All items processed.</Text>
      </Box>
    );
  }

  const plan = plans[idx];
  const ratio = total > 0 ? received / total : 0;
  const elapsed = Math.max(0.1, (Date.now() - startTime) / 1000);
  const rate = received / elapsed;
  const eta = rate > 0 && total > 0 ? (total - received) / rate : Infinity;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Processing </Text>
        <Text color="cyan">[{idx + 1}/{plans.length}]</Text>
        <Text> {plan.quant.quant} → {plan.tag}</Text>
      </Text>
      {step === 'downloading' && (
        <Box>
          <Text color="cyan"><Spinner type="dots" /> </Text>
          <Text>
            Download [{progressBar(ratio)}] {(ratio * 100).toFixed(1)}% · {formatBytes(received)}
            {total > 0 ? ` / ${formatBytes(total)}` : ''} @ {formatRate(rate)} · ETA {formatEta(eta)}
          </Text>
        </Box>
      )}
      {step === 'reusing' && (
        <Text color="green">{icon.circleDouble} Reusing existing GGUF file on disk.</Text>
      )}
      {step === 'writing-modelfile' && (
        <Text color="yellow"><Spinner type="dots" /> Writing Modelfile...</Text>
      )}
      {step === 'creating-ollama' && (
        <Text color="magenta"><Spinner type="dots" /> ollama create {plan.tag} ...</Text>
      )}
      {installed.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">Done so far:</Text>
          {installed.map((m, i) => (
            <Text key={i} color={m.skipped ? 'gray' : 'green'}>
              {m.skipped ? `  ${icon.cross} ` : `  ${icon.tick} `}{m.tag}
              {m.reusedFile && !m.skipped ? ' (reused file)' : ''}
              {m.skipped ? ' (skipped)' : ''}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
