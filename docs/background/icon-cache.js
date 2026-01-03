// 图标缓存配置
const ICON_CACHE_NAME = 'miaowing-tab-icon-cache-v1'
const ICON_CACHE_DURATION = 30 * 24 * 60 * 60 * 1000 // 30天

/**
 * 从 chrome.storage.local 读取缓存的图标 URL
 */
async function getCachedIconUrls() {
  // 检查是否支持 Chrome 扩展 API
  if (!chrome || !chrome.storage) {
    console.warn('当前环境不支持 chrome.storage API，跳过图标 URL 缓存')
    return new Set()
  }

  try {
    const result = await chrome.storage.local.get('cached-online-icon-urls')
    const cached = result['cached-online-icon-urls']
    return Array.isArray(cached) ? new Set(cached) : new Set()
  } catch (error) {
    console.error('从 chrome.storage 读取图标 URL 失败:', error)
    return new Set()
  }
}

/**
 * 检查URL是否为图标资源
 */
async function isIconRequest(url) {
  try {
    // 检查是否在用户缓存的图标 URL 列表中
    const cachedUrls = await getCachedIconUrls()
    if (cachedUrls.has(url)) {
      return true
    }

    // 不在缓存中，说明不是用户选择的图标，不进行缓存
    return false
  } catch (error) {
    return false
  }
}

/**
 * 检查缓存是否过期
 */
function isCacheExpired(response) {
  if (!response || !response.headers) {
    return true
  }

  // 检查 Cache-Control 头
  const cacheControl = response.headers.get('Cache-Control')
  if (cacheControl && cacheControl.includes('no-store')) {
    return true
  }

  // 检查 Date 头
  const dateHeader = response.headers.get('Date')
  if (!dateHeader) {
    return true
  }

  const cachedDate = new Date(dateHeader).getTime()
  const now = Date.now()
  const cacheAge = now - cachedDate

  return cacheAge > ICON_CACHE_DURATION
}

/**
 * 从缓存中获取图标
 */
async function getIconFromCache(request) {
  try {
    const cache = await caches.open(ICON_CACHE_NAME)
    const cachedResponse = await cache.match(request)

    if (!cachedResponse) {
      return null
    }

    // 检查缓存是否过期
    if (isCacheExpired(cachedResponse)) {
      // 缓存已过期，删除并返回null
      await cache.delete(request)
      console.log('图标缓存已过期，已删除:', request.url)
      return null
    }

    console.log('从缓存加载图标:', request.url)
    return cachedResponse
  } catch (error) {
    console.error('从缓存获取图标失败:', error)
    return null
  }
}

/**
 * 缓存图标
 */
async function cacheIcon(request, response) {
  try {
    const cache = await caches.open(ICON_CACHE_NAME)
    const responseToCache = response.clone()
    await cache.put(request, responseToCache)
    console.log('图标已缓存:', request.url)
  } catch (error) {
    console.error('缓存图标失败:', error)
  }
}

/**
 * 清理过期的缓存
 */
async function cleanExpiredCache() {
  try {
    const cache = await caches.open(ICON_CACHE_NAME)
    const requests = await cache.keys()
    let cleanedCount = 0

    for (const request of requests) {
      const response = await cache.match(request)
      if (response && isCacheExpired(response)) {
        await cache.delete(request)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`清理了 ${cleanedCount} 个过期的图标缓存`)
    }
  } catch (error) {
    console.error('清理过期缓存失败:', error)
  }
}

/**
 * 监听 fetch 事件，缓存图标资源
 */
self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      // 检查是否为图标请求
      const isIcon = await isIconRequest(event.request.url)

      if (!isIcon) {
        // 不是图标请求，正常请求
        return fetch(event.request)
      }

      try {
        // 尝试从缓存中获取
        const cachedResponse = await getIconFromCache(event.request)

        if (cachedResponse) {
          return cachedResponse
        }

        // 缓存中没有，从网络获取
        console.log('从网络获取图标:', event.request.url)
        const networkResponse = await fetch(event.request)

        // 检查响应是否成功
        if (!networkResponse || !networkResponse.ok) {
          throw new Error('网络请求失败')
        }

        // 缓存成功的响应
        await cacheIcon(event.request, networkResponse)

        return networkResponse
      } catch (error) {
        console.error('获取图标失败:', event.request.url, error)

        // 网络失败时，尝试从缓存中获取（可能已过期但总比没有好）
        const cachedResponse = await caches.match(event.request)
        if (cachedResponse) {
          console.log('网络失败，使用过期缓存:', event.request.url)
          return cachedResponse
        }

        // 实在不行，返回一个透明的1x1像素图片
        return new Response(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU76/gAAAABJRU5ErkJggg==',
          {
            headers: { 'Content-Type': 'image/png' }
          }
        )
      }
    })()
  )
})

// 在 Service Worker 激活时清理过期缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(cleanExpiredCache())
})
