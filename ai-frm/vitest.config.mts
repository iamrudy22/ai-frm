import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // tsconfig의 paths를 Vitest가 자동으로 읽지 않으므로 직접 맞춰 준다.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 도메인은 순수 TypeScript다. DOM이 필요 없다.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
