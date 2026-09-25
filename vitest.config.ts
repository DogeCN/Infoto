import { defineConfig } from 'vitest/config';

// Root suite: Worker + shared/UI tests (web/ has its own via web/vite.config.ts;
// `npm test` chains both).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
