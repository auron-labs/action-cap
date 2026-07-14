import assert from 'node:assert/strict'
import test from 'node:test'

test('installNavigationListeners stops reacting after cleanup', async () => {
  const originalWindow = globalThis.window
  const originalLocation = globalThis.location
  const originalDocument = globalThis.document
  const originalChrome = globalThis.chrome

  const testWindow = new EventTarget() as Window
  const testLocation = { href: 'https://example.com/initial' } as Location
  const testDocument = { title: 'Recorder test' } as Document
  const testChrome = {
    runtime: {
      onMessage: {
        addListener() {},
      },
      sendMessage() {
        return Promise.resolve({ ok: false, shouldRecord: false })
      },
    },
  } as unknown as typeof chrome

  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: testWindow })
  Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: testLocation })
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: testDocument })
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: testChrome })

  try {
    const { installNavigationListeners } = await import('./recorder.ts')

    let calls = 0
    const cleanup = installNavigationListeners(() => {
      calls += 1
    })

    testLocation.href = 'https://example.com/next'
    testWindow.dispatchEvent(new Event('popstate'))
    assert.equal(calls, 1)

    testLocation.href = 'https://example.com/final#hash'
    testWindow.dispatchEvent(new Event('hashchange'))
    assert.equal(calls, 2)

    cleanup()

    testLocation.href = 'https://example.com/after-cleanup'
    testWindow.dispatchEvent(new Event('popstate'))
    testWindow.dispatchEvent(new Event('hashchange'))
    assert.equal(calls, 2)
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow })
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: originalLocation })
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: originalDocument })
    Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome })
  }
})

test('installNavigationListeners does not duplicate callbacks across reinstall cycles', async () => {
  const originalWindow = globalThis.window
  const originalLocation = globalThis.location
  const originalDocument = globalThis.document
  const originalChrome = globalThis.chrome

  const testWindow = new EventTarget() as Window
  const testLocation = { href: 'https://example.com/initial' } as Location
  const testDocument = { title: 'Recorder test' } as Document
  const testChrome = {
    runtime: {
      onMessage: {
        addListener() {},
      },
      sendMessage() {
        return Promise.resolve({ ok: false, shouldRecord: false })
      },
    },
  } as unknown as typeof chrome

  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: testWindow })
  Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: testLocation })
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: testDocument })
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: testChrome })

  try {
    const { installNavigationListeners } = await import('./recorder.ts')

    let calls = 0

    const cleanupFirstInstall = installNavigationListeners(() => {
      calls += 1
    })

    testLocation.href = 'https://example.com/first-reinstall-hop'
    testWindow.dispatchEvent(new Event('popstate'))
    assert.equal(calls, 1)

    cleanupFirstInstall()

    const cleanupSecondInstall = installNavigationListeners(() => {
      calls += 1
    })

    testLocation.href = 'https://example.com/second-reinstall-hop'
    testWindow.dispatchEvent(new Event('hashchange'))
    assert.equal(calls, 2)

    cleanupSecondInstall()
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow })
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: originalLocation })
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: originalDocument })
    Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome })
  }
})
