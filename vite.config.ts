import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  let outputDirectory = resolve('dist')

  return {
    plugins: [
      react(),
      {
        name: 'exclude-browser-ocr-from-android',
        configResolved(config) {
          outputDirectory = resolve(config.root, config.build.outDir)
        },
        closeBundle() {
          if (mode === 'android') {
            rmSync(resolve(outputDirectory, 'tesseract'), { recursive: true, force: true })
          }
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
        manifest: {
          name: '实时记账',
          short_name: '记账',
          description: '上传消费截图或手动记录个人支出。',
          lang: 'zh-CN',
          theme_color: '#173f37',
          background_color: '#f3f5f2',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
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
  }
})
