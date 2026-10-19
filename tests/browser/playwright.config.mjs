import { defineConfig } from '../../frontend/node_modules/playwright/test.mjs';
import { base } from '../testTarget.mjs';
export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', timeout: 90_000, expect: { timeout: 15_000 }, workers: 1,
  use: { baseURL: base, viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {} },
  outputDir: '../../test-results', reporter: 'list',
});
