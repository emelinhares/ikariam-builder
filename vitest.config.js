import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    exclude: [
      'node_modules/**',
      'dist/**',
      '.claude/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['modules/**/*.js', 'data/**/*.js'],
    },
  },
});
