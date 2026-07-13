const RUNTIME_REGISTRATION_RETRY_MS = 50
const MAX_RUNTIME_REGISTRATION_ATTEMPTS = 20

export const getExtensionApi = () => {
  const candidates = [globalThis.chrome, globalThis.browser]
  return (
    candidates.find((api) => api?.runtime?.id) ||
    candidates.find((api) => api?.runtime) ||
    candidates.find((api) => api?.storage)
  )
}

export const registerRuntimeEvent = (eventName, createListener) => {
  let attempts = 0

  const register = () => {
    const extensionApi = getExtensionApi()
    const event = extensionApi?.runtime?.[eventName]
    if (event?.addListener) {
      event.addListener(createListener(extensionApi))
      return
    }

    attempts += 1
    if (attempts < MAX_RUNTIME_REGISTRATION_ATTEMPTS) {
      setTimeout(register, RUNTIME_REGISTRATION_RETRY_MS)
      return
    }

    console.error(`Extension runtime event is unavailable: ${eventName}`)
  }

  register()
}
