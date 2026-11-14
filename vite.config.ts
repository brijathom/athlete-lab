import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig(({ mode }) => {
  const name = loadEnv(mode, process.cwd(), '').VITE_APP_NAME || 'Athlete Lab'
  return { plugins: [react(), VitePWA({ registerType: 'prompt', includeAssets: ['icon.svg', 'apple-touch-icon.png'], manifest: { name, short_name: name, description: 'Plan, train and track with purpose.', theme_color: '#214d3c', background_color: '#f6f7f2', display: 'standalone', start_url: '/', scope: '/', id: '/', icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/pwa-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], navigateFallback: '/index.html' } })] }
})
