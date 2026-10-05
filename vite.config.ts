import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cloudBackupPlugin } from './scripts/vite-cloud-backup-plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    cloudBackupPlugin(),
    // Web manifest for home-screen install only.
    // No service worker registration — older autoUpdate workers caused mid-use reloads.
    VitePWA({
      injectRegister: false,
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'fonts/DejaVuSans.ttf',
        'fonts/DejaVuSans-Bold.ttf',
      ],
      manifest: {
        name: 'Vuoro — esitelmäassistentti',
        short_name: 'Vuoro',
        description:
          'Sunnuntaisten esitelmien suunnittelu: suositus, WhatsApp-kutsu ja PDF-listat.',
        lang: 'fi',
        theme_color: '#0F3D34',
        background_color: '#0F3D34',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities'],
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Minimal SW file that does nothing useful if somehow registered;
      // app code unregisters all workers on startup.
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        navigateFallback: undefined,
        globPatterns: [],
        runtimeCaching: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
    allowedHosts: true,
  },
})
