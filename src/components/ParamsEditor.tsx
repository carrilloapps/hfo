import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { ResolvedParams } from '../core/plan.js';

interface Row {
  key: keyof ResolvedParams;
  label: string;
  hint: string;
  fromCard: boolean;
  kind: 'float' | 'int' | 'nullable-int';
}

interface Props {
  params: ResolvedParams;
  cardKeys: string[];       // names of params that came from HF card
  onConfirm: (params: ResolvedParams) => void;
  onSkip: () => void;
}

const ROWS: Row[] = [
  { key: 'temperature',   label: 'temperature',   hint: '0.0-2.0 · 0.2-0.4 code · 0.7-0.9 creative', fromCard: false, kind: 'float' },
  { key: 'topP',          label: 'top_p',         hint: '0-1 · 0.9-0.95 standard',                   fromCard: false, kind: 'float' },
  { key: 'topK',          label: 'top_k',         hint: 'integer · 20-100 typical',                  fromCard: false, kind: 'int' },
  { key: 'repeatPenalty', label: 'repeat_penalty',hint: '1.0-1.2 · avoid loops but not structure',   fromCard: false, kind: 'float' },
  { key: 'minP',          label: 'min_p',         hint: '0-1 · 0.05 solid default',                  fromCard: false, kind: 'float' },
  { key: 'numCtx',        label: 'num_ctx',       hint: 'context window tokens',                     fromCard: false, kind: 'int' },
  { key: 'numBatch',      label: 'num_batch',     hint: 'prompt ingest batch; lower if OOM',         fromCard: false, kind: 'int' },
  { key: 'numGpu',        label: 'num_gpu',       hint: 'GPU layers · 99=all · blank=auto',          fromCard: false, kind: 'nullable-int' },
  { key: 'numThread',     label: 'num_thread',    hint: 'CPU threads · blank=auto',                  fromCard: false, kind: 'nullable-int' },
  { key: 'repeatLastN',   label: 'repeat_last_n', hint: 'window for repeat_penalty lookback',        fromCard: false, kind: 'int' },
];

function stringify(v: number | null, kind: Row['kind']): string {
  if (v == null) return '';
  return kind === 'int' || kind === 'nullable-int' ? String(Math.round(v)) : String(v);
}

function parse(v: string, kind: Row['kind']): number | null | undefined {
  const trimmed = v.trim();
  if (trimmed === '') return kind === 'nullable-int' ? null : undefined;
  const n = Number(trimmed);
  if (!isFinite(n)) return undefined;
  if (kind === 'int' || kind === 'nullable-int') return Math.round(n);
  return n;
}

type Mode = { kind: 'list' } | { kind: 'edit'; idx: number; value: string };

export default function ParamsEditor({ params, cardKeys, onConfirm, onSkip }: Props) {
  const [values, setValues] = useState<ResolvedParams>(params);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const rows = ROWS.map((r) => ({ ...r, fromCard: cardKeys.includes(keyToCardName(r.key)) }));

  useInput((input, key) => {
    if (mode.kind === 'edit') return;
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === 'j') setCursor((c) => Math.min(rows.length - 1, c + 1));
    else if (key.return || input === 'e' || input === 'E') {
      const row = rows[cursor];
      setMode({ kind: 'edit', idx: cursor, value: stringify((values[row.key] ?? null) as number | null, row.kind) });
    } else if (input === 's' || input === 'S') {
      onConfirm(values);
    } else if (input === 'r' || input === 'R') {
      setValues(params); // reset to defaults
    } else if (key.escape || input === 'q' || input === 'Q') {
      onSkip();
    }
  });

  if (mode.kind === 'edit') {
    const row = rows[mode.idx];
    return (
      <Box flexDirection="column">
        <Text bold>
          Editing <Text color="cyan">{row.label}</Text>
        </Text>
        <Text color="gray">{row.hint}</Text>
        <Box marginTop={1}>
          <Text color="yellow">{row.label} = </Text>
          <TextInput
            value={mode.value}
            onChange={(v) => setMode({ kind: 'edit', idx: mode.idx, value: v })}
            onSubmit={(v) => {
              const parsed = parse(v, row.kind);
              if (parsed === undefined) {
                setMode({ kind: 'list' });
                return;
              }
              setValues((prev) => ({ ...prev, [row.key]: parsed as never }));
              setMode({ kind: 'list' });
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Modelfile parameters (pre-filled from hardware + HF model card)</Text>
      <Text color="gray">↑↓ nav · Enter/E edit · R reset · S save · Esc/Q skip (use defaults)</Text>
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        {rows.map((row, i) => {
          const v = values[row.key];
          const display = stringify(v as number | null, row.kind);
          const isCursor = i === cursor;
          return (
            <Box key={row.key}>
              <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                {isCursor ? '❯ ' : '  '}
                {row.label.padEnd(16)}
              </Text>
              <Text color="white">= </Text>
              <Text color={row.fromCard ? 'green' : 'yellow'}>
                {display === '' ? '(auto)' : display}
              </Text>
              {row.fromCard && <Text color="green"> ★</Text>}
              <Text color="gray">   {row.hint}</Text>
            </Box>
          );
        })}
      </Box>
      <Text color="gray">★ = value taken from the model's HF README</Text>
    </Box>
  );
}

function keyToCardName(k: keyof ResolvedParams): string {
  switch (k) {
    case 'temperature': return 'temperature';
    case 'topP': return 'top_p';
    case 'topK': return 'top_k';
    case 'repeatPenalty': return 'repeat_penalty';
    case 'minP': return 'min_p';
    case 'numCtx': return 'ctx_size';
    default: return '';
  }
}
