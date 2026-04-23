# Changelog

All notable changes to **hfo** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
