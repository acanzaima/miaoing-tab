import { readResponseBlob } from './network.js'
import { getExtensionApi } from './extension-api.js'

const ICON_CACHE_NAME = 'miaowing-tab-icon-cache-v1'
const ICON_CACHE_DURATION = 30 * 24 * 60 * 60 * 1000
const ICON_CACHE_MAX_SIZE = 2 * 1024 * 1024
const ONLINE_ICON_URLS_KEY = 'cached-online-icon-urls'
const REDIRECT_MAP_KEY = 'icon-redirect-map'
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU76/gAAAABJRU5ErkJggg=='

function isHttpUrl(url) {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
  } catch {
    return false
  }
}

function hasChromeStorage() {
  return Boolean(getExtensionApi()?.storage?.local)
}

async function getCachedIconUrls() {
  if (!hasChromeStorage()) {
    return new Set()
  }

  try {
    const result = await getExtensionApi().storage.local.get(ONLINE_ICON_URLS_KEY)
    const cached = result[ONLINE_ICON_URLS_KEY]
    return Array.isArray(cached) ? new Set(cached.filter(isHttpUrl)) : new Set()
  } catch (error) {
    console.error('Failed to read cached icon urls:', error)
    return new Set()
  }
}

async function getRedirectMap() {
  if (!hasChromeStorage()) {
    return {}
  }

  try {
    const result = await getExtensionApi().storage.local.get(REDIRECT_MAP_KEY)
    const redirectMap = result[REDIRECT_MAP_KEY]
    if (!redirectMap || typeof redirectMap !== 'object' || Array.isArray(redirectMap)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(redirectMap).filter(([originalUrl, finalUrl]) => {
        return isHttpUrl(originalUrl) && typeof finalUrl === 'string' && isHttpUrl(finalUrl)
      })
    )
  } catch (error) {
    console.error('Failed to read icon redirect map:', error)
    return {}
  }
}

async function saveRedirectMapping(originalUrl, finalUrl) {
  if (originalUrl === finalUrl || !isHttpUrl(originalUrl) || !isHttpUrl(finalUrl)) {
    return
  }

  if (!hasChromeStorage()) {
    return
  }

  try {
    const redirectMap = await getRedirectMap()
    redirectMap[originalUrl] = finalUrl
    await getExtensionApi().storage.local.set({
      [REDIRECT_MAP_KEY]: redirectMap
    })
  } catch (error) {
    console.error('Failed to save icon redirect mapping:', error)
  }
}

async function resolveRedirectUrl(originalUrl) {
  if (!isHttpUrl(originalUrl)) {
    return originalUrl
  }

  const redirectMap = await getRedirectMap()
  const redirectedUrl = redirectMap[originalUrl]
  return isHttpUrl(redirectedUrl) ? redirectedUrl : originalUrl
}

async function isIconRequest(url) {
  if (!isHttpUrl(url) || url.includes('/assets/')) {
    return false
  }

  try {
    const cachedUrls = await getCachedIconUrls()
    return cachedUrls.has(url)
  } catch {
    return false
  }
}

function isCacheExpired(response) {
  if (!response?.headers) {
    return true
  }

  const cacheControl = response.headers.get('Cache-Control')
  if (cacheControl?.includes('no-store')) {
    return true
  }

  const dateHeader = response.headers.get('Date')
  if (!dateHeader) {
    return false
  }

  return Date.now() - new Date(dateHeader).getTime() > ICON_CACHE_DURATION
}

async function getIconFromCache(request) {
  try {
    const cache = await caches.open(ICON_CACHE_NAME)
    const cachedResponse = await cache.match(request)
    if (!cachedResponse) {
      return null
    }

    if (isCacheExpired(cachedResponse)) {
      await cache.delete(request)
      return null
    }

    return cachedResponse
  } catch (error) {
    console.error('Failed to read icon cache:', error)
    return null
  }
}

function isImageResponse(response) {
  const contentType = response?.headers?.get('Content-Type')
  if (!contentType) {
    return false
  }

  const normalizedContentType = contentType.toLowerCase()
  return (
    normalizedContentType.startsWith('image/') ||
    normalizedContentType.includes('icon')
  )
}

async function cacheIcon(request, response) {
  try {
    if (!isImageResponse(response)) {
      return
    }

    const blob = await readResponseBlob(response.clone(), ICON_CACHE_MAX_SIZE)
    const cache = await caches.open(ICON_CACHE_NAME)
    await cache.put(
      request,
      new Response(blob, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    )
  } catch (error) {
    console.error('Failed to cache icon:', error)
  }
}

async function cleanExpiredCache() {
  try {
    const cache = await caches.open(ICON_CACHE_NAME)
    const requests = await cache.keys()

    await Promise.all(
      requests.map(async (request) => {
        const response = await cache.match(request)
        if (response && isCacheExpired(response)) {
          await cache.delete(request)
        }
      })
    )
  } catch (error) {
    console.error('Failed to clean expired icon cache:', error)
  }
}

function shouldHandleFetchRequest(request) {
  return request.method === 'GET' && isHttpUrl(request.url)
}

function createTransparentIconResponse() {
  const bytes = Uint8Array.from(atob(TRANSPARENT_PNG_BASE64), (char) => char.charCodeAt(0))
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png'
    }
  })
}

self.addEventListener('fetch', (event) => {
  if (!shouldHandleFetchRequest(event.request)) {
    return
  }

  event.respondWith(
    (async () => {
      const originalUrl = event.request.url
      const isIcon = await isIconRequest(originalUrl)

      if (!isIcon) {
        return fetch(event.request).catch(() => Response.error())
      }

      const redirectUrl = await resolveRedirectUrl(originalUrl)
      const cacheKey = redirectUrl !== originalUrl ? new Request(redirectUrl) : event.request

      try {
        const cachedResponse = await getIconFromCache(cacheKey)
        if (cachedResponse) {
          return cachedResponse
        }

        const networkResponse = await fetch(originalUrl, {
          redirect: 'follow'
        })

        if (networkResponse.url && networkResponse.url !== originalUrl) {
          await saveRedirectMapping(originalUrl, networkResponse.url)
          const finalCacheKey = new Request(networkResponse.url)
          if (networkResponse.status >= 200 && networkResponse.status < 400) {
            await cacheIcon(finalCacheKey, networkResponse)
          }
        } else if (networkResponse.status >= 200 && networkResponse.status < 400) {
          await cacheIcon(cacheKey, networkResponse)
        }

        return networkResponse
      } catch (error) {
        console.error('Failed to fetch icon:', originalUrl, error)

        const cachedResponse = await caches.match(cacheKey)
        if (cachedResponse) {
          return cachedResponse
        }

        return createTransparentIconResponse()
      }
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(cleanExpiredCache())
})
