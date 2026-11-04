import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reportsDirectory: './coverage',
        reporter: ['text-summary', 'lcov', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.spec.ts',
          '**/*.spec.tsx',
          'src/setupTests.ts',
          'src/routeTree.gen.ts',
          '**/*.d.ts',
        ],
      },
    },
  })
);
