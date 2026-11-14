import { defineConfig, devices } from '@playwright/test'
export default defineConfig({ testDir: './tests/e2e', fullyParallel: false, workers: 2, timeout: 60000, use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', actionTimeout: 15000 }, projects: [{ name: 'iPhone', use: { ...devices['iPhone 13'], browserName: 'chromium' } }, { name: 'iPhone Safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } }, { name: 'desktop', use: { ...devices['Desktop Chrome'] } }], webServer: {
  command: 'npm run build -- --outDir .tools/browser-build && npm run preview -- --outDir .tools/browser-build --port 4173 --strictPort',
  url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 120000,
  env: { VITE_SUPABASE_URL: 'https://athlete-lab-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_browser_tests_only' },
} })
