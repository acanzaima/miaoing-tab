import { readResponseBytes } from './network.js'
import { registerRuntimeEvent } from './extension-api.js'

const SEARCH_SUGGESTION_TIMEOUT_MS = 20 * 1000
const CONTENT_TYPE_TIMEOUT_MS = 20 * 1000
const TEXT_RESOURCE_TIMEOUT_MS = 30 * 1000
const WALLPAPER_BLOB_TIMEOUT_MS = 120 * 1000

const SEARCH_SUGGESTION_MAX_SIZE = 1 * 1024 * 1024
const TEXT_RESOURCE_MAX_SIZE = 5 * 1024 * 1024
const WALLPAPER_BLOB_MAX_SIZE = 50 * 1024 * 1024

const TEXT_CONTENT_TYPES = [
  'text/',
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/x-javascript',
  'image/svg+xml'
]

const MEDIA_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|m4v|mov|mp4|ogg|png|svg|webm|webp)(?:[?#].*)?$/i

const getRequestUrl = (request) => {
  const url = request?.payload?.url
  if (typeof url !== 'string') {
    throw createRequestError('INVALID_REQUEST_PAYLOAD', 'Request payload url is invalid')
  }

  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw createRequestError('INVALID_URL_PROTOCOL', 'Only http and https urls are supported')
  }

  return parsedUrl.href
}

const createRequestError = (code, message) => {
  const error = new Error(message)
  error.code = code
  return error
}

const serializeError = (error) => {
  return {
    code: error?.code || error?.name || 'REQUEST_FAILED',
    message: error?.message || 'Request failed'
  }
}

const assertTrustedSender = (sender, runtime) => {
  if (!runtime?.id || sender?.id === runtime.id) {
    return
  }

  const extensionOrigin = runtime.getURL('/')
  if (typeof sender?.url === 'string' && sender.url.startsWith(extensionOrigin)) {
    return
  }

  throw createRequestError('UNTRUSTED_SENDER', 'Runtime message sender is not trusted')
}

const fetchWithTimeout = async (url, options = {}, timeoutMs = TEXT_RESOURCE_TIMEOUT_MS) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      redirect: options.redirect || 'follow',
      referrerPolicy: options.referrerPolicy || 'no-referrer',
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

const fetchHttpResource = async (url, options = {}, timeoutMs = TEXT_RESOURCE_TIMEOUT_MS) => {
  const response = await fetchWithTimeout(url, options, timeoutMs)
  if (!response.ok) {
    throw createRequestError('HTTP_ERROR', `HTTP error! status: ${response.status}`)
  }

  return response
}

const getNormalizedContentType = (response) => {
  return (response.headers.get('content-type') || '').toLowerCase()
}

const isTextContentType = (contentType) => {
  if (!contentType) {
    return true
  }

  return TEXT_CONTENT_TYPES.some((type) => contentType.includes(type))
}

const assertTextResponse = (response) => {
  const contentType = getNormalizedContentType(response)
  if (!isTextContentType(contentType)) {
    throw createRequestError('UNSUPPORTED_CONTENT_TYPE', 'Network resource is not text content')
  }
}

const getTextDecoder = (contentType) => {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase()
  const decoderName = ['gbk', 'gb2312', 'gb18030'].includes(charset || '') ? 'gbk' : 'utf-8'

  return new TextDecoder(decoderName)
}

const readResponseText = async (response, maxSize) => {
  assertTextResponse(response)
  const bytes = await readResponseBytes(response, maxSize)
  return getTextDecoder(getNormalizedContentType(response)).decode(bytes)
}

const isMediaContentType = (contentType) => {
  return contentType.startsWith('image/') || contentType.startsWith('video/')
}

const isGenericBinaryContentType = (contentType) => {
  return !contentType || contentType.includes('application/octet-stream')
}

const assertMediaResponse = (response, url) => {
  const contentType = getNormalizedContentType(response)
  if (isMediaContentType(contentType)) {
    return
  }

  if (isGenericBinaryContentType(contentType) && MEDIA_EXTENSIONS.test(url)) {
    return
  }

  throw createRequestError('UNSUPPORTED_CONTENT_TYPE', 'Network resource is not image or video')
}

const fetchSearchSuggestions = async (url) => {
  const response = await fetchHttpResource(
    url,
    {
      method: 'GET'
    },
    SEARCH_SUGGESTION_TIMEOUT_MS
  )
  return readResponseText(response, SEARCH_SUGGESTION_MAX_SIZE)
}

const fetchNetworkContentType = async (url) => {
  try {
    const response = await fetchHttpResource(
      url,
      {
        method: 'HEAD'
      },
      CONTENT_TYPE_TIMEOUT_MS
    )
    return response.headers.get('content-type') || ''
  } catch {
    const response = await fetchHttpResource(
      url,
      {
        method: 'GET'
      },
      CONTENT_TYPE_TIMEOUT_MS
    )
    return response.headers.get('content-type') || ''
  }
}

const fetchTextResource = async (url) => {
  const response = await fetchHttpResource(
    url,
    {
      method: 'GET'
    },
    TEXT_RESOURCE_TIMEOUT_MS
  )

  return {
    contentType: response.headers.get('content-type') || '',
    data: await readResponseText(response, TEXT_RESOURCE_MAX_SIZE),
    finalUrl: response.url || url
  }
}

const fetchNetworkBlob = async (url) => {
  const response = await fetchHttpResource(
    url,
    {
      method: 'GET'
    },
    WALLPAPER_BLOB_TIMEOUT_MS
  )
  assertMediaResponse(response, url)
  const bytes = await readResponseBytes(response, WALLPAPER_BLOB_MAX_SIZE)

  return {
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    data: Array.from(bytes)
  }
}

const handleRuntimeRequest = async (request, sender, runtime) => {
  assertTrustedSender(sender, runtime)

  if (!request || typeof request !== 'object' || typeof request.type !== 'string') {
    throw createRequestError('INVALID_REQUEST', 'Runtime request is invalid')
  }

  const url = getRequestUrl(request)

  switch (request.type) {
    case 'FETCH_SEARCH_SUGGESTIONS':
      return {
        success: true,
        data: await fetchSearchSuggestions(url)
      }

    case 'FETCH_NETWORK_SOURCE_CONTENT_TYPE':
      return {
        success: true,
        data: await fetchNetworkContentType(url)
      }

    case 'FETCH_TEXT_RESOURCE': {
      const resource = await fetchTextResource(url)
      return {
        success: true,
        contentType: resource.contentType,
        data: resource.data,
        finalUrl: resource.finalUrl
      }
    }

    case 'FETCH_WALLPAPER_BLOB': {
      const resource = await fetchNetworkBlob(url)
      return {
        success: true,
        contentType: resource.contentType,
        data: resource.data
      }
    }

    case 'FEICH_HOST_FAVICON': {
      const resource = await fetchTextResource(url)
      return {
        success: true,
        data: resource.data,
        finalUrl: resource.finalUrl,
        contentType: resource.contentType
      }
    }

    default:
      throw createRequestError('UNKNOWN_REQUEST_TYPE', 'Runtime request type is unknown')
  }
}

registerRuntimeEvent('onMessage', ({ runtime }) => (request, sender, sendResponse) => {
  handleRuntimeRequest(request, sender, runtime)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        success: false,
        error: serializeError(error)
      })
    })

  return true
})
