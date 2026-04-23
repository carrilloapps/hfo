import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
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
    },
  },
});
