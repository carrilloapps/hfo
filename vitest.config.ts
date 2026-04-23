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
      exclude: [
        'src/**/*.tsx',         // Ink UI — out of unit-test scope for now
        'src/cli.tsx',
        'src/Shell.tsx',
        'src/tabs/**',
        'src/components/**',
      ],
    },
  },
});
