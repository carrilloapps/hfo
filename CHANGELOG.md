# Changelog

All notable changes to **hfo** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet — open an issue or PR to propose the next thing._

## [0.2.1] — 2026-09-20

### Fixed

- **macOS installs needed manual steps that Windows did not.** `install.ps1`
  wrote the user PATH outright, so Windows worked in the next shell;
  `install.sh` only printed "add this line yourself" — while the install page
  claimed it edited `~/.profile`, which it never did. It now appends to the
  profile the shell actually reads (`.zprofile` for zsh, `.bash_profile` for
  bash on macOS, `.bashrc` for bash on Linux, `config.fish` for fish, else
  `.profile`), idempotently, with `HFO_NO_MODIFY_PATH=1` to opt out.

- **Gatekeeper blocked the macOS binary on first run.** The installer now
  clears `com.apple.quarantine` after download; without it an unsigned binary
  fails with "developer cannot be verified". The install page documents the
  manual `xattr -d` fix for browser downloads.

- The Windows ARM binary is published again: `pkg` has to execute the target's
  base binary while bundling, so `node22-win-arm64` is built on an ARM runner
  rather than cross-built on x64, and zero-byte outputs from a failed build are
  dropped before upload instead of failing the job.

- Four stale "Node.js ≥ 20" references — in the README, CONTRIBUTING, the
  homepage stat and the install page — left over from the move to Node 22.

### Changed

- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md` moved to
  `.github/`, alongside `SUPPORT.md` and the templates. Nothing moved to
  `docs/`, which is the published Pages site.

- Runner labels are pinned (`ubuntu-24.04`, `macos-26`, `windows-2025`,
  `windows-11-vs2026-arm`) instead of `-latest`, which removes the migration
  notices GitHub was annotating every run with.

### Added

- Install page: a macOS architecture picker, a Gatekeeper section, a note on
  `HFO_VRAM_MIB` for unified-memory tuning, and the `win-arm64` asset row.

## [0.2.0] — 2026-09-19

Cross-platform correctness pass, two new launch targets, and a clean
`pnpm audit`. **This release requires Node.js 22 or newer.**

### Security

- Closed all 25 advisories reported by `pnpm audit` (17 high, 7 moderate,
  1 low) by updating the dependencies that pulled them in: `adm-zip`
  (symlink-following extraction, arbitrary file overwrite),
  `systeminformation`, `ws` (via `ink`), `vite` / `postcss` / `nanoid`,
  `brace-expansion` (via `archiver` and `typescript-eslint`), `esbuild`
  (via `tsx`), and `vitest` / `@vitest/mocker`. `pnpm audit` is now clean.

### Changed

- **Requires Node.js 22 or newer** (was 20). Node 20 reached end of life on
  2026-04-30 and Ink 7 declares `engines.node >= 22`. The CI matrix moves
  from Node 20 / 22 to Node 22 / 24.
- Upgraded React 18 → 19 and Ink 5 → 7. `ink-select-input`,
  `ink-text-input` and `ink-spinner` were already compatible.
- Upgraded `archiver` 7 → 8, which is now ESM-only with named exports and
  no default factory. `src/core/backup.ts` uses `new ZipArchive(...)`, and
  `finalize()` — now promise-returning — rejects into the surrounding
  promise instead of going unhandled.
- Upgraded `adm-zip` 0.5 → 0.6, `execa` 9 → 10, `vitest` 4 → 5, plus
  `eslint`, `typescript-eslint`, `tsx`, `vite`, `systeminformation` and the
  `@types/*` packages to their latest releases.
- **Full platform matrix in CI.** The grid moves from `{ubuntu, macos,
  windows} x {20, 22}` to nine explicit entries covering linux-x64,
  linux-arm64, macos-arm64 (Apple Silicon), macos-x64 (Intel), win-x64 and
  win-arm64 — each primary arch on both supported Node majors, each secondary
  arch on one. Release binaries add a `node22-win-arm64` target.

- GitHub Actions bumped to current majors: `actions/checkout` v7,
  `actions/setup-node` v7, `pnpm/action-setup` v6, `actions/deploy-pages` v5.

- The release workflow now creates the GitHub Release itself, with notes
  lifted from this file by `scripts/changelog-section.mjs`, before the binary
  matrix runs. Previously the release only came into existence as a
  side-effect of a binary upload, so a release where every `pkg` build failed
  produced no release at all.

- TypeScript stays on 6.0.3. TypeScript 7 typechecks this project cleanly,
  but `typescript-eslint` 8.70 refuses to load against the TS 7 API
  (typescript-eslint#10940), so `pnpm lint` would break. Revisit once
  typescript-eslint ships TS 7 support.

### Fixed

- **Apple Silicon reported 0 GB of VRAM, so every model scored as CPU-only.**
  `systeminformation` has no discrete VRAM to report on an Apple GPU, which
  left `vramMiB` at zero — on an M-series Mac with 64 GB of unified memory,
  capable of running a 70B model on the GPU, hfo advertised "no GPU" and
  recommended accordingly. `detectHardware()` now derives the real budget:
  it reads the `iogpu.wired_limit_mb` sysctl (or `debug.iogpu.wired_limit`
  on older macOS) and uses it verbatim when set, otherwise falls back to a
  tiered share of total RAM. The whole scoring, tiering and picks pipeline
  keys off `vramMiB`, so fixing detection at the source corrects all of it.

  The default share is a heuristic: Apple does not publish the rule and
  measurements range from ~62% to ~78% across machines and OS releases.
  The tiers sit at the conservative end deliberately — over-estimating makes
  hfo recommend a quant that then spills to swap, which is a worse failure
  than under-promising by a gigabyte. `HFO_VRAM_MIB` overrides the result on
  any platform for anyone who knows their real figure.

- `HardwareProfile` gained `unifiedMemory`, and `--view` now marks the VRAM
  line with a footnote on Apple Silicon, where VRAM and RAM are one pool and
  would otherwise read as memory the machine does not have.

### Added

- **Plugin API for custom launch integrations** (roadmap item). A
  `launch-plugins.json` in hfo's config dir registers extra agents, which then
  appear in the TUI picker and `hfo --launch-targets` and work with
  `hfo --launch <id>` exactly like a built-in. Plugin targets are always
  spawned directly, since anything Ollama serves is already built in.

  Entries are validated rather than trusted: an id may not shadow a built-in id
  or alias, so `hfo --launch claude` cannot be redefined, and a malformed entry
  is skipped with a reason instead of breaking the picker. Problems are listed
  by `--launch-targets`, which exits non-zero when any are present.

- **Kiro CLI and Antigravity CLI as launch targets.** `hfo --launch kiro` and
  `hfo --launch antigravity` (aliases `kiro-cli` and `agy`), both listed in the
  TUI launch picker and in the new `hfo --launch-targets` table.

  Neither is served by `ollama launch`, so `LaunchTarget` gained a `runner`
  descriptor: existing targets keep delegating to `ollama launch <id>`, while
  these two are spawned by hfo directly (`kiro-cli chat` and `agy`). Their
  availability is probed by resolving the binary rather than by scanning
  `ollama launch --help`, so the picker distinguishes "not installed" from
  "unsupported by this Ollama", and a missing binary exits 127.

- `hfo --launch-targets`: headless mirror of the launch picker — every target,
  its runner, whether it is usable here, and whether it can bind a local model.

- `test/platform.test.ts` for the new `resolveBinary` / `expandHome` helpers.

### Known limitations

- **Kiro and Antigravity cannot run on a local Ollama model.** Kiro CLI has no
  custom-endpoint setting, and Antigravity's own docs state there is no
  bring-your-own-key or bring-your-own-endpoint; `agy models` only lists
  Google-served ids. hfo therefore launches both but refuses to imply a binding
  that will not happen: passing `--model <ollama-tag>` prints a warning, is
  dropped rather than forwarded, and is recorded as `null` in the launch
  manifest. A vendor model id (`agy --model gemini-3.1-pro-high`) is forwarded
  normally; `kiro-cli` has no model flag at all, so none is ever passed. Both
  hints point at MCP as the route that does reach local tooling. Tracking:
  ollama/ollama#16329, kirodotdev/Kiro#9367.

- `test/restore.test.ts`: a backup → restore round-trip that asserts the
  extracted bytes match the source, covering the new `archiver` and
  `adm-zip` majors together.

## [0.1.0] — 2026-04-24

First public release of **hfo** (`hfo-cli` on npm).

### Added — core product

- Fullscreen TUI with six tabs (Dashboard, Models, Install, Tune, Help,
  Settings) on top of a hardware-aware install engine. Alt-screen buffer
  preserves your scrollback on exit.
- Hardware scoring: every GGUF in a Hugging Face repo graded 0–100
  against usable VRAM and RAM, with per-quant labels like `Full GPU`,
  `Partial 87%`, `CPU-heavy`.
- Hugging Face model-card parser: pulls recommended `temperature`,
  `top_p`, `top_k`, `repeat_penalty`, `min_p`, and context size into the
  generated Modelfile.
- Quick-confirm install flow: on the happy path a new model installs in
  three keystrokes — pick a quant, press <kbd>Enter</kbd>, wait. Branches
  to the file browser (<kbd>O</kbd>) or params editor (<kbd>C</kbd>) only
  when there's something to decide.
- Orphan reinstall (<kbd>I</kbd>): tags removed from Ollama but whose
  GGUFs still live on disk get recovered, regenerating the Modelfile when
  needed.
- Zip backup + restore with level-9 compression, streaming (multi-GB
  safe), sidecar `metadata.json` per backup.
- Deep delete: <kbd>d</kbd> removes the Ollama tag only, <kbd>Alt</kbd>+<kbd>d</kbd>
  also wipes the tracked directory.
- ~90% capacity Ollama env tuner for `OLLAMA_FLASH_ATTENTION`,
  `OLLAMA_KV_CACHE_TYPE`, `OLLAMA_KEEP_ALIVE`, `OLLAMA_NUM_PARALLEL`,
  `OLLAMA_MAX_LOADED_MODELS`, `OLLAMA_MAX_QUEUE`. Persists via `setx`
  (Windows) · `launchctl setenv` + `~/.zprofile` (macOS) · `~/.profile`
  + systemd override (Linux).
- 7 themes (Dark, Light, Dracula, Solarized Dark/Light, Nord, Monokai)
  and 20 language packs with live language switching from Settings.

### Added — CLI & scripting

- Headless flag equivalents for every TUI capability: `--view` · `--list`
  · `--tune` · `--backup` · `--restore` · `--delete` · `--launch` · `--tab`.
- Launch matrix `L` / `--launch <integration>` wiring into Claude Code,
  Cline, Codex, Copilot CLI, Droid, Hermes, Kimi, OpenCode, OpenClaw, Pi,
  and VS Code, with runtime probing against `ollama launch --help` to
  mark unsupported targets.
- **Coding-agent launch manifest + hints.** Every `--launch <agent>`
  writes a JSON manifest to
  `<configDir>/hfo/agent-launches/<agent>.json` recording which model was
  bound to which agent and when, then prints a per-agent hint block
  listing the env vars / config keys needed to route that agent through
  the local Ollama (Claude Code, Codex, Cline, OpenCode, Droid, VS Code,
  Copilot CLI). hfo never mutates user-owned config files — only records
  and educates.
- **`hfo --bench <tag>`.** A standardised 4-prompt benchmark (warmup ·
  code · reasoning · translation) that runs against a local Ollama model
  and reports tokens-per-second and time-to-first-token, both per-prompt
  and aggregate. Uses Ollama's streaming `/api/generate` endpoint and the
  server-reported `eval_count` / `eval_duration` for accurate tok/s.
  `--out <file>` writes an `hfo-bench-v1` JSON submission that can be
  contributed to the community leaderboard at
  <https://hfo.carrillo.app/benchmarks/>.
- Portable default install directory: models download to the current
  working directory (`process.cwd()`) when neither `--dir/-d` nor
  `settings.modelDir` is set, making every invocation self-contained.
- ASCII boot screen that runs while hardware probing / Ollama detection
  / settings loading happens, and a short "Goodbye" splash on exit.
- One-liner install scripts for every OS:
  `curl -fsSL https://hfo.carrillo.app/install.sh | sh` and
  `irm https://hfo.carrillo.app/install.ps1 | iex`.

### Added — website & AI search

- GitHub Pages landing at <https://hfo.carrillo.app> with full-viewport
  (`100vh`) two-column hero, ambient orb + grid backdrop, CSS-only
  package-manager switcher (npm / pnpm / yarn / bun / curl+powershell),
  stacked terminal preview with scoring bars, and three responsive tiers
  (desktop ≥ 1025 px, tablet 641–1024 px, mobile ≤ 640 px).
- Shared `<hfo-terminal>` Web Component at `docs/assets/terminal.js` —
  every code-block terminal on the site renders through one upgrade point
  (the hero keeps its unique markup).
- Install pill detects the visitor's OS and auto-adapts the script tab
  to `irm … | iex` on Windows and `curl … | sh` on macOS / Linux.
- Five standalone sub-pages with unique title / description / canonical /
  JSON-LD BreadcrumbList: `/install/` (with HowTo schema), `/cli/`,
  `/keyboard/`, `/privacy/`, `/faq/` (with FAQPage schema). Plus
  `/benchmarks/` for the bench leaderboard. Sitemap lists seven URLs.
- AI-search instrumentation: `docs/llms.txt` (curated site map for
  ChatGPT / Perplexity / Claude / Gemini) and `docs/llms-full.txt`
  (flattened prose version of the full documentation).
- Stats strip inside Features with live chips (npm version, CI status,
  tests, GitHub stars, Node ≥ 20, MIT, Windows · macOS · Linux as OS
  icons). Replaces the noisier trust-row that used to live in the hero.
- Structured data stack: `WebSite`, `Person`, `SoftwareApplication`,
  `FAQPage`, `BreadcrumbList`, `HowTo`.
- Rasterised favicon + Open Graph PNG pipeline (the Pages workflow
  rasterises `og-image.svg` into `og-image.png` at build time).
- 404 page with same design system, `noindex, nofollow`, internal
  recovery links.
- `humans.txt`, `.well-known/security.txt` (RFC 9116), and a `CNAME` for
  the custom domain.

### Added — repository hygiene

- GitHub community-health files: issue form templates (bug_report /
  feature_request), pull request template, `CODEOWNERS`,
  `dependabot.yml`, `FUNDING.yml`, `SUPPORT.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, this changelog.
- GitHub Actions: CI matrix (Ubuntu / macOS / Windows × Node 20 / 22 →
  typecheck + lint + test + build), Pages deploy, and a release workflow
  that ships per-OS standalone binaries to GitHub Releases **only** when
  a `v*.*.*` tag is pushed. npm publish is performed manually by the
  maintainer, not automated.
- 14 test suites / 96 vitest cases covering every module in `src/core`,
  `src/infra`, and `src/ui`. Coverage tracked via v8.

### Notes

- Requires Node.js 20 or newer (npm / pnpm / yarn / bun installs). The
  per-OS standalone binaries shipped with each tagged release have no
  Node dependency.
- Ollama is optional: if missing, hfo offers to install it via `winget`
  (Windows), `brew` (macOS), or the official shell script (Linux).
- No telemetry, no accounts, no subscriptions — only the two public
  Hugging Face endpoints and the local Ollama daemon.

[Unreleased]: https://github.com/carrilloapps/hfo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/carrilloapps/hfo/releases/tag/v0.1.0
