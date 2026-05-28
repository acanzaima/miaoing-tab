import './fetch.js'
import './icon-cache.js'

const RELEASE_NOTES_PENDING_VERSION_KEY = 'miaowing-release-notes-pending-version'

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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'update') {
    return
  }

  const currentVersion = chrome.runtime.getManifest().version
  chrome.storage.local.set({
    [RELEASE_NOTES_PENDING_VERSION_KEY]: {
      version: currentVersion,
      previousVersion: details.previousVersion || ''
    }
  })
})
