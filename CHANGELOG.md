# Changelog

All notable changes to **hfo** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`hfo --bench <tag>`**. A standardised 4-prompt benchmark (warmup · code ·
  reasoning · translation) that runs against a local Ollama model and
  reports tokens-per-second and time-to-first-token, both per-prompt and
  aggregate. Uses Ollama's streaming `/api/generate` endpoint and the
  server-reported `eval_count` / `eval_duration` for accurate tok/s.
  `--out <file>` writes an `hfo-bench-v1` JSON submission that can be
  contributed to the community leaderboard at
  <https://hfo.carrillo.app/benchmarks/>.
- **Coding-agent launch manifest + hints.** Every `hfo --launch <agent>`
  now (1) writes a small JSON manifest to
  `<configDir>/hfo/agent-launches/<agent>.json` recording which model was
  bound to which agent and when, and (2) prints a per-agent hint block
  listing the env vars / config keys the user needs to set for that agent
  (Claude Code, Codex, Cline, OpenCode, Droid, VS Code, Copilot CLI) to
  actually route through the local Ollama. hfo never mutates user-owned
  config files — only records and educates.
- **AI-search instrumentation**. `docs/llms.txt` (curated site map for
  ChatGPT / Perplexity / Claude / Gemini) and `docs/llms-full.txt`
  (flattened prose version of the full documentation).
- **Five standalone documentation pages.** The homepage sections have been
  split into real crawlable URLs with unique title / description / canonical
  / JSON-LD BreadcrumbList:
  `/install/` (with a `HowTo` schema), `/cli/`, `/keyboard/`, `/privacy/`,
  `/faq/` (with `FAQPage` schema). Plus `/benchmarks/` for the new bench
  leaderboard. Sitemap.xml now lists seven URLs instead of one.
- **Shared sub-page stylesheet** at `docs/assets/page.css` so the new
  pages stay visually consistent with the landing without duplicating 600
  lines of hero CSS.

### Changed

- **Portable default install directory.** `hfo` now downloads GGUFs into the
  current working directory (`process.cwd()`) when neither `--dir/-d` nor
  `settings.modelDir` is set. The previous behaviour — a hard-coded
  `D:/Desarrollo/AI/LLMs` (Windows) or `~/AI/LLMs` (Unix) — has been removed.
  Running `hfo` in any folder now drops its models alongside the project,
  making the tool fully self-contained.
- **Install-pill OS detection.** The landing's package-manager switcher
  auto-adapts its `curl` tab to the visitor's OS — shows
  `irm … | iex` with the label `powershell` on Windows, `curl … | sh` with
  the label `curl` everywhere else. Uses `navigator.userAgentData.platform`
  with a UA-string fallback.
- **Robots.txt** now disallows `/install.sh` and `/install.ps1` so Google
  doesn't index raw shell / PowerShell source as text content.
- **Hero CTA layout**. Removed the `Get started` button (redundant with
  the pm-tabs above it) and replaced it with `View on npm`. Removed the
  six trust chips from the hero and moved their content to a quieter
  data-dense stats strip at the top of the Features section.
- **Landing hero redesign.** `docs/index.html` now uses a full-viewport
  (`100vh`) two-column hero with an ambient orb + grid backdrop, a CSS-only
  package-manager switcher (npm / pnpm / yarn / bun / curl), live trust
  chips (npm version, CI status, tests, stars, Node ≥ 20, OS support), and
  a stacked terminal preview that shows scoring bars for the quant picker.
  Three responsive tiers — desktop ≥ 1025 px, tablet 641–1024 px,
  mobile ≤ 640 px — replace the previous single mobile breakpoint. Dead
  rules from the v1 hero were retired.
- **README hero refresh.** Wordmark is linked, tagline tightened, badges
  switched to `for-the-badge` style with the brand palette, and the
  signature terminal snippet matches the site hero for cross-surface
  consistency. An accidental `claude --resume …` line that had leaked into
  line 1 of `README.md` was removed.

### Added

- Initial public release. See [README.md](./README.md) for the full feature
  list.
- Fullscreen TUI with six tabs (Dashboard, Models, Install, Tune, Help,
  Settings) on top of a hardware-aware install engine.
- Headless CLI equivalents for every tab capability:
  `--view` · `--list` · `--tune` · `--backup` · `--restore` · `--delete` ·
  `--launch` · `--tab`.
- One-liner install scripts for every OS:
  `curl -fsSL https://hfo.carrillo.app/install.sh | sh` and
  `irm https://hfo.carrillo.app/install.ps1 | iex`.
- Ollama launch-menu shortcut `L` wiring into
  `claude · cline · codex · copilot · droid · hermes · kimi · opencode · openclaw · pi · vscode`.
- Zip backup + restore pipeline with level-9 compression and a sidecar
  `metadata.json` per backup; orphan reinstall that regenerates the
  Modelfile from the GGUF alone when needed.
- 20 language packs and 7 themes with a reusable searchable dropdown
  component.
- ASCII boot screen that runs while hardware probing / Ollama detection /
  settings loading happens, and a short "Goodbye" splash on exit.
- GitHub Pages landing at <https://hfo.carrillo.app> with JSON-LD
  (WebSite + Person + SoftwareApplication + FAQPage), terminal-styled
  code blocks, a 404 page, `humans.txt`, `.well-known/security.txt`, and
  a rasterised favicon + Open Graph pipeline.
- GitHub community-health files: issue form templates (bug_report /
  feature_request), pull request template, `CODEOWNERS`,
  `dependabot.yml`, `FUNDING.yml`, `SUPPORT.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and this changelog.
- GitHub Actions: CI matrix (Ubuntu / macOS / Windows × Node 20 / 22 →
  typecheck + lint + test + build), Pages deploy (rasterises favicons
  before publishing), and a release workflow that ships per-OS binaries
  to GitHub Releases **only** when a `v*.*.*` tag is pushed.

<!--
When cutting a release, copy the items above into a dated version block
below, e.g.

## [0.1.0] - 2026-05-01
### Added
### Changed
### Fixed

…and then clear the Unreleased section for the next cycle.
-->

[Unreleased]: https://github.com/carrilloapps/hfo/compare/main...HEAD
