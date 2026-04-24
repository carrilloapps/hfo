# Changelog

All notable changes to **hfo** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet — open an issue or PR to propose the next thing._

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
