# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (lockfile is `pnpm-lock.yaml`; `packageManager` is pinned in `package.json`). Node ≥ 20.

```bash
pnpm dev           # run from source via tsx (src/cli.tsx)
pnpm build         # tsc → dist/ (required before `pnpm start` or `npm link`)
pnpm typecheck     # tsc --noEmit (strict mode, every flag on)
pnpm lint          # eslint flat config; `pnpm lint:fix` to autofix
pnpm test          # vitest run (all suites under test/)
pnpm test:watch    # TDD loop
pnpm test:coverage # v8 coverage — only src/core, src/infra, src/ui, headless.ts are tracked
pnpm run ci        # typecheck + lint + test + build (run this before PR)
pnpm start         # node bin/hfo.js (requires prior build)
```

Run a single vitest file or pattern:

```bash
pnpm vitest run test/scoring.test.ts
pnpm vitest run -t "scores a quant"   # by test name
```

`bin/hfo.js` is the published entrypoint; it just imports `dist/cli.js`. During development always use `pnpm dev`.

## Architecture

### Two entry points, one engine

`src/cli.tsx` parses argv with `meow` then dispatches to one of two shells that share every other module:

- **Headless CLI** (`--view`, `--list`, `--tune`, `--backup`, `--restore`, `--delete`, and `--launch` without a TUI step) — runs an exported function from `src/headless.ts`, prints plain text, exits with a status code. Never renders Ink.
- **Fullscreen TUI** — everything else. `cli.tsx` manages the alt-screen buffer itself (writes `\x1b[?1049h` on entry, restores on `exit`/`SIGINT`/`SIGTERM`), then renders `<Shell>`. `Shell.tsx` is the 6-tab router (Dashboard · Models · Install · Tune · Help · Settings) and handles global keys. `App.tsx` is the install-flow state machine mounted under the Install tab (see below).

Both shells read the same `settings.json`, write the same backup format, and call the same `ollama` commands. When adding a capability, decide whether it belongs in the shared layer (`core/`, `infra/`, `ui/`) or one of the two entry paths — then expose a TUI affordance AND a headless flag for parity.

### Layered module groups under `src/`

The split is strict. Tests only cover the bottom three layers.

- **`src/core/`** — pure domain logic, zero UI, zero OS side effects. Unit-testable from `test/`. Examples: `hf.ts` (HF API client + resumable downloader), `hardware.ts`, `scoring.ts`, `capacity.ts`, `readme.ts` (HF card parser), `plan.ts` (install plans + conflict detection), `modelfile.ts` (Modelfile generator + tag slugifier), `backup.ts`, `restore.ts`, `reinstall.ts`, `launch.ts`, `describe.ts`, `live.ts`.
- **`src/infra/`** — cross-OS platform integration. `ollama.ts` wraps the CLI and persists env via `setx` (Windows), `launchctl setenv` + `~/.zprofile` (macOS), `~/.profile` + systemd override (Linux). `platform.ts` owns `openUrl` and config-dir resolution. `settings.ts` persists preferences + the `installations[]` index. `about.ts` loads package.json metadata.
- **`src/ui/`** — UI-layer primitives consumed by tabs + components: `theme.ts` (7-theme registry), `i18n.ts` (20-language catalogs, `setLang`/`t`), `icons.ts` (figures-backed), `hooks.ts` (`useTerminalSize`, `useInterval`, `useNow`), `format.ts`.
- **`src/tabs/`** and **`src/components/`** — React/Ink. Vitest does not cover these; exclusions live in `vitest.config.ts`.

Anything that shells out, reads the filesystem, or touches env vars goes in `infra/`. Anything pure goes in `core/`. Breaking that separation breaks testability.

### Install flow state machine (`src/App.tsx`)

The install path is a discriminated-union `Phase` FSM, not a linear sequence. Each `useEffect` matches one phase kind and advances to the next. Key branch points:

- `quants-picked` — if a **single** quant was picked and there are **no** tag/dir conflicts, jump to `quick-confirm` (the three-keystroke fast path: Enter = install, O = change dir, C = customize). Anything else falls through to `building-plans` → `reviewing`.
- `quick-confirm` branches into `change-dir` (FileBrowser), `params-editing` (ParamsEditor), `processing` (install-now), or back to `scored` (Esc).

When editing install flow: add a new `Phase` variant, a matching `useEffect` (or render branch), and keep discrimination exhaustive — the `strict` tsconfig will catch missing cases.

### Settings-driven TUI state

`Shell.tsx` loads `Settings` once at mount, then passes it down. Language switching calls `setLang()` synchronously BEFORE `setSettings` so the next render sees the new i18n catalog (`updateSettings` in `Shell.tsx`). If you add a setting that affects rendered strings, follow the same pattern.

### Alt-screen buffer lifecycle

The alt-screen is managed by `cli.tsx`, not Ink. Any code path that exits (including fatal errors in the TUI) must restore it — `cli.tsx` wires this up for `exit`/`SIGINT`/`SIGTERM`. Don't add new exit paths that bypass `restoreAltScreen()`.

## Project conventions

These are enforced by code review and (where possible) ESLint. CONTRIBUTING.md has the full version.

- **Strict TypeScript** — all flags on in `tsconfig.json`. Don't introduce `any` unless truly irreducible.
- **No raw emojis in source strings.** Use `src/ui/icons.ts` (backed by `figures`, with ASCII fallback on legacy consoles).
- **Cross-OS is non-negotiable.** OS-specific code lives behind `src/infra/platform.ts` or `src/infra/ollama.ts`. Don't branch on `process.platform` outside those.
- **English source identifiers and fallback strings.** Translations in `src/ui/i18n.ts` across 20 languages — keep keys in sync when adding UI text.
- **No telemetry.** `hfo` only talks to the public Hugging Face API (`huggingface.co/api/models/...` and `/resolve/`) and the local Ollama daemon. Don't add external calls.
- **TUI ↔ headless parity.** Every TUI capability has a headless flag equivalent. When adding one side, add the other.
- **Adding a tab** — create `src/tabs/<Name>Tab.tsx`, register in `Shell.tsx` (`TAB_ORDER` + `labels` + `hotkey`), add a `hints.<name>` key to `src/ui/i18n.ts`, update the README keyboard section.

## Path aliases

None. Relative imports use `.js` extensions (ESM + NodeNext-style resolution via `moduleResolution: Bundler`): `import { foo } from './core/hf.js'` even though the source is `hf.ts`. Keep this consistent in new files.
