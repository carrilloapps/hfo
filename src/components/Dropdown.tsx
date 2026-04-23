import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import type { Theme } from '../ui/theme.js';

export interface DropdownItem<T extends string = string> {
  id: T;
  label: string;
  detail?: string;        // secondary info displayed next to the label
  description?: string;   // multi-line description shown under the cursor row
  group?: string;         // optional grouping header
}

export interface DropdownProps<T extends string = string> {
  theme: Theme;
  title: string;
  items: DropdownItem<T>[];
  value: T | null;
  onSelect: (id: T) => void;
  onCancel: () => void;
  searchable?: boolean;    // show a filter box; defaults to true when items.length > 6
  maxVisible?: number;     // cap rows shown at once (with scroll). Default 10.
  placeholder?: string;
}

/**
 * Reusable keyboard-driven dropdown / picker. Renders as a modal-like
 * overlay that consumes all input while mounted: arrow keys navigate, Enter
 * confirms, Esc cancels, typing filters results (when searchable).
 *
 * Because ink's `useInput` is process-wide, the caller is responsible for
 * mounting this component conditionally so it owns the input focus during
 * its lifetime.
 */
export function Dropdown<T extends string = string>(props: DropdownProps<T>) {
  const {
    theme,
    title,
    items,
    value,
    onSelect,
    onCancel,
    searchable,
    maxVisible = 10,
    placeholder,
  } = props;

  const effectiveSearchable = searchable ?? items.length > 6;

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(() => {
    const idx = items.findIndex((i) => i.id === value);
    return Math.max(0, idx);
  });
  const [scroll, setScroll] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.id.toLowerCase().includes(q) ||
        i.label.toLowerCase().includes(q) ||
        (i.detail ?? '').toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q) ||
        (i.group ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  // Keep cursor within filtered bounds when the filter changes
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  useInput((input, key) => {
    if (key.upArrow) {
      const next = Math.max(0, safeCursor - 1);
      setCursor(next);
      if (next < scroll) setScroll(next);
    } else if (key.downArrow) {
      const next = Math.min(filtered.length - 1, safeCursor + 1);
      setCursor(next);
      if (next >= scroll + maxVisible) setScroll(next - maxVisible + 1);
    } else if (key.pageUp) {
      const next = Math.max(0, safeCursor - maxVisible);
      setCursor(next);
      setScroll(Math.max(0, next));
    } else if (key.pageDown) {
      const next = Math.min(filtered.length - 1, safeCursor + maxVisible);
      setCursor(next);
      setScroll(Math.max(0, Math.min(next - maxVisible + 1, filtered.length - maxVisible)));
    } else if (key.return) {
      const item = filtered[safeCursor];
      if (item) onSelect(item.id);
    } else if (key.escape) {
      onCancel();
    }
  });

  const visible = filtered.slice(scroll, scroll + maxVisible);
  const focused = filtered[safeCursor];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.accent as any}>{title}</Text>
        <Text color={theme.muted as any}>
          {'   '}{filtered.length} / {items.length}
        </Text>
      </Box>

      {effectiveSearchable && (
        <Box marginBottom={1}>
          <Text color={theme.muted as any}>{t('dropdown.search')}: </Text>
          <TextInput
            value={query}
            onChange={(v) => {
              setQuery(v);
              setCursor(0);
              setScroll(0);
            }}
            onSubmit={() => {
              const item = filtered[safeCursor];
              if (item) onSelect(item.id);
            }}
            placeholder={placeholder ?? ''}
          />
        </Box>
      )}

      <Box flexDirection="column" borderStyle="round" borderColor={theme.border as any} paddingX={1}>
        {filtered.length === 0 && (
          <Text color={theme.muted as any}>{t('dropdown.empty')}</Text>
        )}
        {visible.map((item, i) => {
          const absIdx = i + scroll;
          const isCursor = absIdx === safeCursor;
          const isCurrent = item.id === value;
          return (
            <Box key={item.id}>
              <Text color={isCursor ? (theme.accent as any) : undefined} bold={isCursor}>
                {isCursor ? `${icon.pointer} ` : '  '}
              </Text>
              <Text color={isCurrent ? (theme.success as any) : (theme.text as any)}>
                {isCurrent ? `${icon.tick} ` : '  '}
              </Text>
              <Text color={theme.primary as any}>{item.label}</Text>
              {item.detail && <Text color={theme.muted as any}>  ·  {item.detail}</Text>}
            </Box>
          );
        })}
        {filtered.length > maxVisible && (
          <Text color={theme.muted as any}>
            {icon.ellipsis} {scroll + 1}-{Math.min(scroll + maxVisible, filtered.length)} of {filtered.length}
          </Text>
        )}
      </Box>

      {focused?.description && (
        <Box marginTop={1} borderStyle="single" borderColor={theme.primary as any} paddingX={1}>
          <Text color={theme.muted as any}>{focused.description}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted as any}>{t('dropdown.selectHint')}</Text>
      </Box>
    </Box>
  );
}

export default Dropdown;
