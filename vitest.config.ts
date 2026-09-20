import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/core/**/*.ts',
        'src/infra/**/*.ts',
        'src/ui/**/*.ts',
        'src/headless.ts',
      ],
      exclude: [
        'src/**/*.tsx',         // Ink UI — covered by hand testing, not unit tests
        'src/cli.tsx',
        'src/Shell.tsx',
        'src/App.tsx',
        'src/tabs/**',
        'src/components/**',
      ],
      // The layers above are fully covered and must stay that way: a new
      // branch without a test fails `pnpm test:coverage` rather than quietly
      // eroding the number. Unreachable defensive code is deleted, not
      // ignored, so there are no v8-ignore comments propping this up.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
