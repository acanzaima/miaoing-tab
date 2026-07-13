const createResponseSizeError = (code) => {
  const error = new Error(code)
  error.code = code
  return error
}

const assertContentLength = (response, maxSize, errorCode) => {
  const rawContentLength = response.headers.get('content-length')
  if (!rawContentLength) {
    return
  }

  const contentLength = Number(rawContentLength)
  if (Number.isFinite(contentLength) && contentLength > maxSize) {
    throw createResponseSizeError(errorCode)
  }
}

export const readResponseBytes = async (
  response,
  maxSize,
  errorCode = 'RESOURCE_TOO_LARGE'
) => {
  assertContentLength(response, maxSize, errorCode)

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxSize) {
      throw createResponseSizeError(errorCode)
    }
    return new Uint8Array(buffer)
  }

  const reader = response.body.getReader()
  const chunks = []
  let totalSize = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      totalSize += value.byteLength
      if (totalSize > maxSize) {
        await reader.cancel().catch(() => undefined)
        throw createResponseSizeError(errorCode)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalSize)
  let offset = 0
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  })
  return bytes
}

export const readResponseBlob = async (
  response,
  maxSize,
  errorCode = 'RESOURCE_TOO_LARGE'
) => {
  const bytes = await readResponseBytes(response, maxSize, errorCode)
  return new Blob([bytes], {
    type: response.headers.get('content-type') || 'application/octet-stream'
  })
}
