import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ANDROID_SERVICE_WORKER_RETIREMENT = `
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
    await self.clients.claim()
    const windows = await self.clients.matchAll({ type: 'window' })
    await self.registration.unregister()
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => undefined)))
  })())
})
`

const ANDROID_SERVICE_WORKER_CLEANUP = `
void (async () => {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    }
    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
    }
  } catch {
    // Cache cleanup must never prevent the native app from starting.
  }
})()
`

function retireAndroidServiceWorker(): Plugin {
  return {
    name: 'retire-service-worker-on-android',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          children: ANDROID_SERVICE_WORKER_CLEANUP,
          injectTo: 'head-prepend' as const,
        },
      ]
    },
    generateBundle() {
      // Older APKs cached both index.html and registerSW.js. Keeping these stable URLs lets the
      // old page install this no-fetch worker, which clears its Workbox cache and reloads once.
      this.emitFile({
        type: 'asset',
        fileName: 'registerSW.js',
        source: "if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined)\n",
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: ANDROID_SERVICE_WORKER_RETIREMENT,
      })
    },
  }
}

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
      mode === 'android'
        ? retireAndroidServiceWorker()
        : VitePWA({
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
