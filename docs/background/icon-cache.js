// 图标缓存配置
const ICON_CACHE_NAME = 'miaowing-tab-icon-cache-v1'
const ICON_CACHE_DURATION = 30 * 24 * 60 * 60 * 1000 // 30天
const REDIRECT_MAP_KEY = 'icon-redirect-map' // URL 重定向映射表键名

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
 * 从 chrome.storage.local 读取 URL 重定向映射表
 */
async function getRedirectMap() {
  // 检查是否支持 Chrome 扩展 API
  if (!chrome || !chrome.storage) {
    return {}
  }

  try {
    const result = await chrome.storage.local.get(REDIRECT_MAP_KEY)
    return result[REDIRECT_MAP_KEY] || {}
  } catch (error) {
    console.error('从 chrome.storage 读取重定向映射表失败:', error)
    return {}
  }
}

/**
 * 保存 URL 重定向映射
 */
async function saveRedirectMapping(originalUrl, finalUrl) {
  // 如果原始 URL 和最终 URL 相同，不需要保存
  if (originalUrl === finalUrl) {
    return
  }

  // 检查是否支持 Chrome 扩展 API
  if (!chrome || !chrome.storage) {
    return
  }

    try {
    const redirectMap = await getRedirectMap()
    redirectMap[originalUrl] = finalUrl
    await chrome.storage.local.set({
      [REDIRECT_MAP_KEY]: redirectMap
    })
    // console.log('已保存重定向映射:', originalUrl, '->', finalUrl)
  } catch (error) {
    console.error('保存重定向映射失败:', error)
  }
}

/**
 * 解析 URL，获取最终的重定向 URL
 */
async function resolveRedirectUrl(originalUrl) {
  const redirectMap = await getRedirectMap()

  // 检查是否有重定向映射
  if (redirectMap[originalUrl]) {
    // console.log('使用已缓存的重定向 URL:', originalUrl, '->', redirectMap[originalUrl])
    return redirectMap[originalUrl]
  }

  // 没有重定向映射，返回原始 URL
  return originalUrl
}

/**
 * 检查URL是否为图标资源
 */
async function isIconRequest(url) {
  try {
    // 不处理本地图标路径（以 /assets/ 开头）
    if (url.includes('/assets/')) {
      return false
    }

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
      // console.log('图标缓存已过期，已删除:', request.url)
      return null
    }

    // console.log('从缓存加载图标:', request.url)
    return cachedResponse
  } catch (error) {
    console.error('从缓存获取图标失败:', error)
    return null
  }
}

/**
 * 检查响应是否为图片类型
 */
function isImageResponse(response) {
  if (!response || !response.headers) {
    return false
  }

  const contentType = response.headers.get('Content-Type')
  if (!contentType) {
    return false
  }

  // 检查是否为图片类型（包括常见图片格式）
  const imageTypes = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/ico'
  ]

  return imageTypes.some(type => contentType.includes(type))
}

/**
 * 缓存图标
 */
async function cacheIcon(request, response) {
  try {
    // 检查响应是否为图片类型
    if (!isImageResponse(response)) {
      console.warn('响应不是图片类型，跳过缓存:', request.url, response.headers?.get('Content-Type'))
      return
    }

    const cache = await caches.open(ICON_CACHE_NAME)
    const responseToCache = response.clone()
    await cache.put(request, responseToCache)
    // console.log('图标已缓存:', request.url)
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
      // console.log(`清理了 ${cleanedCount} 个过期的图标缓存`)
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

      // 解析重定向 URL
      const originalUrl = event.request.url
      const redirectUrl = await resolveRedirectUrl(originalUrl)
      const shouldUseRedirectUrl = redirectUrl !== originalUrl

      // 如果有重定向映射，使用重定向后的 URL 构造新的请求
      const cacheKey = shouldUseRedirectUrl ? new Request(redirectUrl) : event.request

      try {
        // 尝试从缓存中获取（使用重定向后的 URL 作为缓存键）
        const cachedResponse = await getIconFromCache(cacheKey)

        if (cachedResponse) {
          return cachedResponse
        }

        // 缓存中没有，从网络获取
        // console.log('从网络获取图标:', originalUrl, shouldUseRedirectUrl ? `(重定向: ${redirectUrl})` : '')

        let networkResponse
        try {
          networkResponse = await fetch(originalUrl, {
            // 确保跟随重定向
            redirect: 'follow'
          })
        } catch (fetchError) {
          // fetch 本身失败（如 DNS 错误、网络断开等）
          console.error('fetch 请求失败:', originalUrl, fetchError)
          throw fetchError
        }

        // 检查响应是否存在
        if (!networkResponse) {
          throw new Error('网络响应为空')
        }

        // 保存重定向映射（如果发生了重定向）
        if (networkResponse.url && networkResponse.url !== originalUrl) {
          await saveRedirectMapping(originalUrl, networkResponse.url)
          // 使用最终 URL 作为缓存键
          const finalCacheKey = new Request(networkResponse.url)
          if (networkResponse.status >= 200 && networkResponse.status < 400) {
            await cacheIcon(finalCacheKey, networkResponse)
          }
        } else {
          // 没有发生重定向，使用原始 URL 作为缓存键
          if (networkResponse.status >= 200 && networkResponse.status < 400) {
            await cacheIcon(cacheKey, networkResponse)
          }
        }

        // 如果响应状态码不是 2xx，记录警告但仍然尝试使用
        if (!networkResponse.ok) {
          console.warn('图标响应状态异常:', originalUrl, networkResponse.status, networkResponse.statusText)
        }

        return networkResponse
      } catch (error) {
        console.error('获取图标失败:', originalUrl, error)

        // 网络失败时，尝试从缓存中获取（可能已过期但总比没有好）
        const cachedResponse = await caches.match(cacheKey)
        if (cachedResponse) {
          // console.log('网络失败，使用过期缓存:', originalUrl)
          return cachedResponse
        }

        // 实在不行，返回一个透明的1x1像素图片
        console.warn('无法获取图标，返回占位图片:', originalUrl)
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
