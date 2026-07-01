import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '实时记账',
        short_name: '记账',
        description: '上传消费截图或手动记录个人支出。',
        theme_color: '#1867c0',
        background_color: '#eef3f8',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // OCR 的 worker/wasm/模型走应用本地资源、识别时按需加载，
        // 不纳入 Service Worker 预缓存（体积大；APK 内置 assets 也无需预缓存）。
        globIgnores: ['**/tesseract/**'],
      },
    }),
  ],
})
