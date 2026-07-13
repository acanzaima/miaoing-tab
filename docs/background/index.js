import './fetch.js'
import './icon-cache.js'
import { registerRuntimeEvent } from './extension-api.js'

const RELEASE_NOTES_PENDING_VERSION_KEY = 'miaowing-release-notes-pending-version'
const STARTER_PRESET_PENDING_KEY = 'miaowing-starter-preset-pending'

// Service Worker 生命周期事件
self.addEventListener('install', (event) => {
  console.log('Service Worker 安装成功')
  // 跳过等待阶段，立即激活
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('Service Worker 激活成功')
  // 接管所有页面
  event.waitUntil(self.clients.claim())
})

registerRuntimeEvent('onInstalled', ({ runtime, storage }) => (details) => {
  const currentVersion = runtime.getManifest().version

  if (details.reason === 'install') {
    storage.local.set({
      [STARTER_PRESET_PENDING_KEY]: {
        version: currentVersion,
        createdAt: Date.now()
      }
    })
    return
  }

  if (details.reason !== 'update') {
    return
  }

  storage.local.set({
    [RELEASE_NOTES_PENDING_VERSION_KEY]: {
      version: currentVersion,
      previousVersion: details.previousVersion || ''
    }
  })
})
