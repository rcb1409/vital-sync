import { defineConfig } from 'vitest/config';
import path from 'path';

// Vitest resolves imports itself and does not read tsconfig `paths`.
// Without this alias, any test that pulls in a service using `@/config/...`
// fails to load — the suite never runs rather than failing a assertion.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
