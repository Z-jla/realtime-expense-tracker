import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const outputDirectory = resolve('dist')
const index = readFileSync(resolve(outputDirectory, 'index.html'), 'utf8')
const retirementWorker = readFileSync(resolve(outputDirectory, 'sw.js'), 'utf8')
const registrationBridge = readFileSync(resolve(outputDirectory, 'registerSW.js'), 'utf8')

assert.doesNotMatch(index, /manifest\.webmanifest|vite-plugin-pwa:register-sw/)
assert.match(index, /serviceWorker\.getRegistrations/)
assert.match(retirementWorker, /registration\.unregister/)
assert.match(retirementWorker, /client\.navigate/)
assert.match(registrationBridge, /serviceWorker\.register\('\/sw\.js'\)/)
assert.equal(
  readdirSync(outputDirectory).some((fileName) => /^workbox-.*\.js$/.test(fileName)),
  false,
)
assert.equal(existsSync(resolve(outputDirectory, 'tesseract')), false)

console.log('Android Web 资源已禁用 PWA 缓存，并包含旧 Service Worker 迁移脚本。')
