#!/usr/bin/env node
/**
 * Recommended Claude Code skills for contributing to hfo.
 *
 * We deliberately do NOT commit the skill definitions themselves because
 * they are user-local tooling that changes outside this repo — exactly the
 * same reasoning the wider community converged on (see
 * https://github.com/anthropics/claude-code/discussions and the official
 * "skills live in ~/.claude/skills" guidance). Committing them would freeze
 * a snapshot and surface churn that has nothing to do with the project.
 *
 * Running `pnpm run skills:install` (or `npm run skills:install`) prints
 * the exact steps to get the same skill set the maintainers use. The
 * script is intentionally read-only: it never invokes Claude Code for you,
 * because different users may have different Claude Code versions
 * installed and the install command has varied across releases.
 */
const SKILLS = [
  {
    name: 'react-ink',
    why: 'API reference + usage patterns for ink components and hooks — the core UI library of hfo.',
  },
  {
    name: 'interface-design',
    why: 'Critique and validation heuristics for TUI polish before shipping changes.',
  },
  {
    name: 'brainstorming',
    why: 'Structured feature exploration for scoping new tabs, flows, or CLI flags.',
  },
  {
    name: 'documentation-writer',
    why: 'README / CONTRIBUTING / docs-site polish conventions.',
  },
  {
    name: 'changelog-generator',
    why: 'Release notes aligned with the conventions used on tagged releases.',
  },
];

const bold = (s) => `\x1b[1m${s}\x1b[22m`;
const dim  = (s) => `\x1b[2m${s}\x1b[22m`;
const cyan = (s) => `\x1b[36m${s}\x1b[39m`;
const yell = (s) => `\x1b[33m${s}\x1b[39m`;

console.log();
console.log(bold('  Recommended Claude Code skills for hfo'));
console.log(dim('  Skills live in ~/.claude/skills/ and are user-local on purpose.'));
console.log();

for (const s of SKILLS) {
  console.log(`  ${cyan(s.name.padEnd(24))}${s.why}`);
}

console.log();
console.log(bold('  How to install'));
console.log();
console.log('  1. Open Claude Code in any project.');
console.log(`  2. Run each skill's install command from within Claude Code:`);
console.log();
for (const s of SKILLS) {
  console.log(`       ${yell('/skill install ' + s.name)}`);
}
console.log();
console.log('  3. Verify with ' + yell('/skills') + ' — all five should appear.');
console.log();
console.log(dim('  Skills are never committed to this repo — see CONTRIBUTING.md > "Recommended skills".'));
console.log();
