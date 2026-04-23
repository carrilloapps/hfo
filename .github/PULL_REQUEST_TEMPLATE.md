## Summary

<!-- What does this PR change and why? Link issues with "Fixes #123" or "Refs #123". -->

## Testing

- [ ] `pnpm run ci` passes locally (typecheck + lint + test + build)
- [ ] Added or updated tests under `test/` for any new logic
- [ ] Manually tested on <!-- Windows / macOS / Linux / not needed -->

## Scope checklist

- [ ] Follows the coding style in [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] No raw emojis in source — uses `src/icons.ts`
- [ ] No new telemetry, external calls beyond the HF public API, or Google Fonts
- [ ] OS-specific logic lives behind `src/platform.ts` or `src/ollama.ts`
- [ ] i18n keys for any new user-visible strings (see `src/i18n.ts`)
- [ ] Stricter typing: no new `any`, `!` non-null assertions only when truly irreducible

## Screenshots or recording

<!-- UI / TUI / docs-site changes only. Drag media directly into this box. -->

## Release notes

<!-- One line suitable for CHANGELOG.md. Leave blank for pure refactors. -->
