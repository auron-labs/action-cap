import assert from 'node:assert/strict'
import test from 'node:test'

type CapturedMessage = unknown

interface TestHarness {
  cleanup: () => void
  postMessage: (data: unknown) => void
  captured: () => CapturedMessage[]
  setSendMessageResult: (result: Promise<unknown>) => void
}

function setupBridge(state: { recording: boolean; sessionId: string | null }): TestHarness {
  const originalWindow = globalThis.window
  const originalChrome = globalThis.chrome
  const originalLocation = globalThis.location
  const originalDocument = globalThis.document

  const captured: CapturedMessage[] = []
  const messageListeners = new Set<(event: MessageEvent) => void>()

  let sendMessageResult: Promise<unknown> = Promise.resolve({ ok: true })

  const testWindow = new EventTarget() as Window
  ;(testWindow as unknown as { postMessage: (data: unknown, origin: string) => void }).postMessage = (
    data: unknown,
    _origin: string,
  ) => {
    captured.push(data)
  }

  const testLocation = { href: 'https://example.com/page', origin: 'https://example.com' } as Location
  const testDocument = { title: 'Test Page' } as Document

  const testChrome = {
    runtime: {
      sendMessage(message: unknown) {
        captured.push(message)
        return sendMessageResult
      },
    },
  } as unknown as typeof chrome

  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: testWindow })
  Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: testLocation })
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: testDocument })
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: testChrome })

  // installBridge registers a listener on window 'message' events
  // We need to capture that listener when it's added
  const originalAddEventListener = testWindow.addEventListener.bind(testWindow)
  ;(testWindow as unknown as { addEventListener: typeof originalAddEventListener }).addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'message' && typeof listener === 'function') {
      messageListeners.add(listener as (event: MessageEvent) => void)
    }
    originalAddEventListener(type, listener, options)
  }

  const originalRemoveEventListener = testWindow.removeEventListener.bind(testWindow)
  ;(testWindow as unknown as { removeEventListener: typeof originalRemoveEventListener }).removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'message') {
      messageListeners.delete(listener as (event: MessageEvent) => void)
    }
    originalRemoveEventListener(type, listener, options)
  }

  const dispatchMessage = (data: unknown) => {
    const event = {
      source: testWindow,
      data,
    } as MessageEvent
    for (const listener of messageListeners) {
      listener(event)
    }
  }

  return {
    cleanup() {
      Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow })
      Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: originalLocation })
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: originalDocument })
      Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome })
    },
    postMessage: dispatchMessage,
    captured: () => captured,
    setSendMessageResult(result: Promise<unknown>) {
      sendMessageResult = result
    },
  }
}

test('ping returns recording state when idle', async () => {
  const { installBridge } = await import('./bridge.ts')

  const harness = setupBridge({ recording: false, sessionId: null })

  try {
    const cleanup = installBridge(() => ({ recording: false, sessionId: null }))

    harness.postMessage({ source: 'actioncap-bridge-request', id: 'req-1', type: 'ping' })

    // Allow microtasks to flush
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const responses = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })

    assert.equal(responses.length, 1)
    const response = responses[0] as { id: string; ok: boolean; recording: boolean }
    assert.equal(response.id, 'req-1')
    assert.equal(response.ok, true)
    assert.equal(response.recording, false)

    cleanup()
  } finally {
    harness.cleanup()
  }
})

test('ping returns recording state when recording', async () => {
  const { installBridge } = await import('./bridge.ts')

  const harness = setupBridge({ recording: true, sessionId: 'sess-123' })

  try {
    const cleanup = installBridge(() => ({ recording: true, sessionId: 'sess-123' }))

    harness.postMessage({ source: 'actioncap-bridge-request', id: 'req-2', type: 'ping' })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const responses = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })

    assert.equal(responses.length, 1)
    const response = responses[0] as { id: string; ok: boolean; recording: boolean; sessionId?: string }
    assert.equal(response.id, 'req-2')
    assert.equal(response.ok, true)
    assert.equal(response.recording, true)
    assert.equal(response.sessionId, 'sess-123')

    cleanup()
  } finally {
    harness.cleanup()
  }
})

test('ingest-action forwards user action to service worker when recording', async () => {
  const { installBridge } = await import('./bridge.ts')

  const harness = setupBridge({ recording: true, sessionId: 'sess-action' })

  try {
    const cleanup = installBridge(() => ({ recording: true, sessionId: 'sess-action' }))

    harness.postMessage({
      source: 'actioncap-bridge-request',
      id: 'req-action-1',
      type: 'ingest-action',
      event: {
        type: 'click',
        url: 'https://example.com/page',
        title: 'Example Page',
        selector: '#btn',
        element: { tagName: 'button', text: 'Submit' },
        coordinates: { x: 10, y: 20 },
      },
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    // Verify a RECORDED_USER_ACTION message was sent to the SW
    const swMessages = harness.captured().filter((m) => {
      const msg = m as { type?: string }
      return msg?.type === 'RECORDED_USER_ACTION'
    })

    assert.equal(swMessages.length, 1)
    const swMessage = swMessages[0] as { type: string; event: { sessionId: string; tabId: number; type: string; url: string } }
    assert.equal(swMessage.type, 'RECORDED_USER_ACTION')
    assert.equal(swMessage.event.sessionId, 'sess-action')
    assert.equal(swMessage.event.tabId, -1)
    assert.equal(swMessage.event.type, 'click')
    assert.equal(swMessage.event.url, 'https://example.com/page')

    // Verify a success response was posted back
    const responses = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })

    assert.equal(responses.length, 1)
    const response = responses[0] as { id: string; ok: boolean; recording: boolean; sessionId?: string }
    assert.equal(response.id, 'req-action-1')
    assert.equal(response.ok, true)
    assert.equal(response.recording, true)
    assert.equal(response.sessionId, 'sess-action')

    cleanup()
  } finally {
    harness.cleanup()
  }
})

test('ingest-action rejects unsupported action type', async () => {
  const { installBridge } = await import('./bridge.ts')

  const harness = setupBridge({ recording: true, sessionId: 'sess-xyz' })

  try {
    const cleanup = installBridge(() => ({ recording: true, sessionId: 'sess-xyz' }))

    harness.postMessage({
      source: 'actioncap-bridge-request',
      id: 'req-bad-action',
      type: 'ingest-action',
      event: { type: 'tab-activated' },
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const responses = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })

    assert.equal(responses.length, 1)
    const response = responses[0] as { id: string; ok: boolean; error?: string }
    assert.equal(response.id, 'req-bad-action')
    assert.equal(response.ok, false)
    assert.match(response.error ?? '', /Unsupported action type: tab-activated/)

    // Verify NO RECORDED_USER_ACTION message was sent to the SW
    const swMessages = harness.captured().filter((m) => {
      const msg = m as { type?: string }
      return msg?.type === 'RECORDED_USER_ACTION'
    })
    assert.equal(swMessages.length, 0)

    cleanup()
  } finally {
    harness.cleanup()
  }
})

test('ingest-action returns not-recording error when idle', async () => {
  const { installBridge } = await import('./bridge.ts')

  const harness = setupBridge({ recording: false, sessionId: null })

  try {
    const cleanup = installBridge(() => ({ recording: false, sessionId: null }))

    harness.postMessage({
      source: 'actioncap-bridge-request',
      id: 'req-idle-1',
      type: 'ingest-action',
      event: { type: 'click' },
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const responses = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })

    assert.equal(responses.length, 1)
    const response = responses[0] as { id: string; ok: boolean; recording: boolean; error?: string }
    assert.equal(response.id, 'req-idle-1')
    assert.equal(response.ok, false)
    assert.equal(response.recording, false)
    assert.match(response.error ?? '', /Not recording/)

    cleanup()
  } finally {
    harness.cleanup()
  }
})

test('ingest-replay forwards rrweb-style payload to service worker when recording', async () => {
  const { installBridge } = await import('./bridge.ts')

  const harness = setupBridge({ recording: true, sessionId: 'sess-replay' })

  try {
    const cleanup = installBridge(() => ({ recording: true, sessionId: 'sess-replay' }))

    const rrwebPayload = { type: 2, data: { node: { id: 1, tagName: 'html' } } }

    harness.postMessage({
      source: 'actioncap-bridge-request',
      id: 'req-replay-1',
      type: 'ingest-replay',
      payload: rrwebPayload,
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const swMessages = harness.captured().filter((m) => {
      const msg = m as { type?: string }
      return msg?.type === 'RECORDED_RRWEB_EVENT'
    })

    assert.equal(swMessages.length, 1)
    const swMessage = swMessages[0] as {
      type: string
      event: { sessionId: string; tabId: number; ts: number; payload: { type: number } }
    }
    assert.equal(swMessage.type, 'RECORDED_RRWEB_EVENT')
    assert.equal(swMessage.event.sessionId, 'sess-replay')
    assert.equal(swMessage.event.tabId, -1)
    assert.equal(swMessage.event.payload.type, 2)

    const responses = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })

    assert.equal(responses.length, 1)
    const response = responses[0] as { id: string; ok: boolean; recording: boolean }
    assert.equal(response.id, 'req-replay-1')
    assert.equal(response.ok, true)
    assert.equal(response.recording, true)

    cleanup()
  } finally {
    harness.cleanup()
  }
})

test('bridge ignores messages from other sources', async () => {
  const { installBridge } = await import('./bridge.ts')

  const harness = setupBridge({ recording: true, sessionId: 'sess-ignore' })

  try {
    const cleanup = installBridge(() => ({ recording: true, sessionId: 'sess-ignore' }))

    // Wrong source
    harness.postMessage({ source: 'some-other-extension', id: 'req-x', type: 'ping' })
    // Not a valid request shape
    harness.postMessage({ source: 'actioncap-bridge-request', type: 'ping' })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const responses = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })

    assert.equal(responses.length, 0)

    cleanup()
  } finally {
    harness.cleanup()
  }
})

test('bridge stops responding after cleanup', async () => {
  const { installBridge } = await import('./bridge.ts')

  const harness = setupBridge({ recording: true, sessionId: 'sess-cleanup' })

  try {
    const cleanup = installBridge(() => ({ recording: true, sessionId: 'sess-cleanup' }))

    harness.postMessage({ source: 'actioncap-bridge-request', id: 'before-cleanup', type: 'ping' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const responsesBefore = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })
    assert.equal(responsesBefore.length, 1)

    // Clear captured and clean up
    harness.captured().length = 0
    cleanup()

    harness.postMessage({ source: 'actioncap-bridge-request', id: 'after-cleanup', type: 'ping' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const responsesAfter = harness.captured().filter((m) => {
      const msg = m as { source?: string }
      return msg?.source === 'actioncap-bridge-response'
    })
    assert.equal(responsesAfter.length, 0)
  } finally {
    harness.cleanup()
  }
})
