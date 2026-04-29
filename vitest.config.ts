import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'tests/__mocks__/vscode.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'src/exporters/markdownTokens.ts',
        'src/exporters/exportTxt.ts',
        'src/warehouse/secretScanner.ts',
        'src/warehouse/warehouseConfig.ts',
        'src/themes/themes.ts',
        'src/updates/updateChecker.ts',
      ],
      exclude: ['tests/__mocks__/**'],
    },
  },
});
