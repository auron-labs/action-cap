import assert from 'node:assert/strict'
import test from 'node:test'

import {
  captureResponseChunk,
  createResponseCaptureState,
  disableResponseBodyRetention,
  FirefoxNetworkCapture,
} from './firefox-network-capture.ts'

type ListenerCallback<T> = (details: T) => void

type FakeListener<T> = {
  callback: ListenerCallback<T> | null
  extraInfoSpec?: string[]
  addListener(
    callback: ListenerCallback<T>,
    filter?: { urls: string[]; types?: string[] },
    extraInfoSpec?: string[],
  ): void
}

type FakeFilter = {
  onstart: ((event: Event) => void) | null
  ondata: ((event: { data: ArrayBuffer }) => void) | null
  onstop: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  writes: Uint8Array[]
  closeCalls: number
  disconnectCalls: number
  write(data: ArrayBuffer | Uint8Array): void
  close(): void
  disconnect(): void
}

function createListener<T>(): FakeListener<T> {
  return {
    callback: null,
    addListener(callback, _filter, extraInfoSpec) {
      this.callback = callback
      this.extraInfoSpec = extraInfoSpec
    },
  }
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function decodeChunks(chunks: Uint8Array[]): string {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }

  return new TextDecoder().decode(combined)
}

function createFakeBrowser(options: { filterResponseDataThrows?: boolean } = {}) {
  const listeners = {
    onBeforeRequest: createListener<any>(),
    onSendHeaders: createListener<any>(),
    onHeadersReceived: createListener<any>(),
    onCompleted: createListener<any>(),
    onErrorOccurred: createListener<any>(),
  }
  const filters = new Map<string, FakeFilter>()

  return {
    browser: {
      webRequest: {
        ...listeners,
        filterResponseData(requestId: string) {
          if (options.filterResponseDataThrows) {
            throw new Error('filterResponseData unavailable')
          }

          const filter: FakeFilter = {
            onstart: null,
            ondata: null,
            onstop: null,
            onerror: null,
            writes: [],
            closeCalls: 0,
            disconnectCalls: 0,
            write(data) {
              this.writes.push(toUint8Array(data).slice())
            },
            close() {
              this.closeCalls += 1
            },
            disconnect() {
              this.disconnectCalls += 1
            },
          }

          filters.set(requestId, filter)
          return filter
        },
      },
    },
    listeners,
    filters,
  }
}

function createChunk(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

test('captureResponseChunk truncates at the byte limit and binary cleanup drops retained bytes', () => {
  const state = createResponseCaptureState()

  captureResponseChunk(state, new TextEncoder().encode('abc'), 5)
  captureResponseChunk(state, new TextEncoder().encode('defg'), 5)

  assert.equal(state.capturedBytes, 5)
  assert.equal(state.truncated, true)
  assert.equal(decodeChunks(state.chunks), 'abcde')

  disableResponseBodyRetention(state)
  captureResponseChunk(state, new TextEncoder().encode('ignored'), 5)

  assert.equal(state.retainBody, false)
  assert.equal(state.capturedBytes, 0)
  assert.deepEqual(state.chunks, [])
  assert.equal(state.truncated, true)
})

test('FirefoxNetworkCapture writes chunks through immediately and waits for onstop before emitting a response', async () => {
  const originalBrowser = (globalThis as { browser?: unknown }).browser
  const fakeBrowser = createFakeBrowser()
  ;(globalThis as { browser?: unknown }).browser = fakeBrowser.browser

  const events: Array<Record<string, unknown>> = []
  const capture = new FirefoxNetworkCapture(async (event) => {
    events.push(event as unknown as Record<string, unknown>)
  }, () => true, () => 'session-1')

  try {
    capture.start()

    assert.deepEqual(fakeBrowser.listeners.onBeforeRequest.extraInfoSpec, ['blocking', 'requestBody'])

    fakeBrowser.listeners.onBeforeRequest.callback?.({
      requestId: 'request-1',
      tabId: 7,
      url: 'https://example.com/data.txt',
      method: 'GET',
      type: 'xmlhttprequest',
    })
    fakeBrowser.listeners.onHeadersReceived.callback?.({
      requestId: 'request-1',
      tabId: 7,
      url: 'https://example.com/data.txt',
      method: 'GET',
      type: 'xmlhttprequest',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      responseHeaders: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }],
    })

    const filter = fakeBrowser.filters.get('request-1')
    assert.ok(filter)
    const streamFilter = filter

    streamFilter.ondata?.({ data: createChunk('hello ') })
    streamFilter.ondata?.({ data: createChunk('world') })

    assert.equal(streamFilter.closeCalls, 0)
    assert.equal(streamFilter.writes.length, 2)
    assert.equal(decodeChunks(streamFilter.writes), 'hello world')

    fakeBrowser.listeners.onCompleted.callback?.({ requestId: 'request-1', tabId: 7 })
    await Promise.resolve()

    assert.equal(events.length, 0)

    streamFilter.onstop?.({} as Event)
    await Promise.resolve()

    assert.equal(streamFilter.closeCalls, 1)
    assert.equal(streamFilter.writes.length, 2)
    assert.equal(decodeChunks(streamFilter.writes), 'hello world')
    assert.equal(events.length, 1)
    assert.equal(events[0]?.phase, 'response')
    assert.equal(events[0]?.responseBody, 'hello world')
    assert.equal(events[0]?.mimeType, 'text/plain')
    assert.equal(events[0]?.truncated, false)
  } finally {
    if (originalBrowser === undefined) {
      delete (globalThis as { browser?: unknown }).browser
    } else {
      ;(globalThis as { browser?: unknown }).browser = originalBrowser
    }
  }
})

test('FirefoxNetworkCapture streams large text responses through and caps the stored body', async () => {
  const originalBrowser = (globalThis as { browser?: unknown }).browser
  const fakeBrowser = createFakeBrowser()
  ;(globalThis as { browser?: unknown }).browser = fakeBrowser.browser

  const events: Array<Record<string, unknown>> = []
  const capture = new FirefoxNetworkCapture(async (event) => {
    events.push(event as unknown as Record<string, unknown>)
  }, () => true, () => 'session-1')

  const firstChunk = 'a'.repeat(700_000)
  const secondChunk = 'b'.repeat(400_000)
  const fullResponse = firstChunk + secondChunk

  try {
    capture.start()

    fakeBrowser.listeners.onBeforeRequest.callback?.({
      requestId: 'request-large-text',
      tabId: 70,
      url: 'https://example.com/large.txt',
      method: 'GET',
      type: 'xmlhttprequest',
    })
    fakeBrowser.listeners.onHeadersReceived.callback?.({
      requestId: 'request-large-text',
      tabId: 70,
      url: 'https://example.com/large.txt',
      method: 'GET',
      type: 'xmlhttprequest',
      mimeType: 'text/plain',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      responseHeaders: [],
    })

    const filter = fakeBrowser.filters.get('request-large-text')
    assert.ok(filter)
    const streamFilter = filter

    streamFilter.ondata?.({ data: createChunk(firstChunk) })
    streamFilter.ondata?.({ data: createChunk(secondChunk) })

    assert.equal(streamFilter.closeCalls, 0)
    assert.equal(streamFilter.writes.length, 2)
    assert.equal(decodeChunks(streamFilter.writes), fullResponse)

    fakeBrowser.listeners.onCompleted.callback?.({ requestId: 'request-large-text', tabId: 70 })
    await Promise.resolve()

    assert.equal(events.length, 0)

    streamFilter.onstop?.({} as Event)
    await Promise.resolve()

    assert.equal(streamFilter.closeCalls, 1)
    assert.equal(events.length, 1)
    assert.equal(events[0]?.phase, 'response')
    assert.equal((events[0]?.responseBody as string | undefined)?.length, 1_000_000)
    assert.equal((events[0]?.responseBody as string | undefined), fullResponse.slice(0, 1_000_000))
    assert.equal(events[0]?.truncated, true)
  } finally {
    if (originalBrowser === undefined) {
      delete (globalThis as { browser?: unknown }).browser
    } else {
      ;(globalThis as { browser?: unknown }).browser = originalBrowser
    }
  }
})

test('FirefoxNetworkCapture streams large binary responses through and drops retained body bytes after MIME classification', async () => {
  const originalBrowser = (globalThis as { browser?: unknown }).browser
  const fakeBrowser = createFakeBrowser()
  ;(globalThis as { browser?: unknown }).browser = fakeBrowser.browser

  const events: Array<Record<string, unknown>> = []
  const capture = new FirefoxNetworkCapture(async (event) => {
    events.push(event as unknown as Record<string, unknown>)
  }, () => true, () => 'session-1')

  const firstChunk = 'a'.repeat(700_000)
  const secondChunk = 'b'.repeat(700_000)
  const fullResponse = firstChunk + secondChunk

  try {
    capture.start()

    fakeBrowser.listeners.onBeforeRequest.callback?.({
      requestId: 'request-2',
      tabId: 8,
      url: 'https://example.com/image.png',
      method: 'GET',
      type: 'image',
    })

    const filter = fakeBrowser.filters.get('request-2')
    assert.ok(filter)
    const streamFilter = filter
    const responseKey = '8:request-2'

    streamFilter.ondata?.({ data: createChunk(firstChunk) })
    const preClassificationState = (capture as any).responseStates.get(responseKey)
    assert.equal(preClassificationState.capturedBytes, 700_000)
    assert.equal(preClassificationState.retainBody, true)

    fakeBrowser.listeners.onHeadersReceived.callback?.({
      requestId: 'request-2',
      tabId: 8,
      url: 'https://example.com/image.png',
      method: 'GET',
      type: 'image',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      responseHeaders: [{ name: 'content-type', value: 'image/png' }],
    })

    const postClassificationState = (capture as any).responseStates.get(responseKey)
    assert.equal(postClassificationState.capturedBytes, 0)
    assert.equal(postClassificationState.retainBody, false)
    assert.deepEqual(postClassificationState.chunks, [])

    streamFilter.ondata?.({ data: createChunk(secondChunk) })
    streamFilter.onstop?.({} as Event)
    await Promise.resolve()

    assert.equal(decodeChunks(streamFilter.writes), fullResponse)
    assert.equal(events.length, 1)
    assert.equal(events[0]?.responseBody, '[binary image/png omitted]')
    assert.equal(events[0]?.truncated, true)
  } finally {
    if (originalBrowser === undefined) {
      delete (globalThis as { browser?: unknown }).browser
    } else {
      ;(globalThis as { browser?: unknown }).browser = originalBrowser
    }
  }
})

test('FirefoxNetworkCapture.clear disconnects in-flight filters and drops retained state', () => {
  const originalBrowser = (globalThis as { browser?: unknown }).browser
  const fakeBrowser = createFakeBrowser()
  ;(globalThis as { browser?: unknown }).browser = fakeBrowser.browser

  const capture = new FirefoxNetworkCapture(async () => {}, () => true, () => 'session-1')

  try {
    capture.start()

    fakeBrowser.listeners.onBeforeRequest.callback?.({
      requestId: 'request-3',
      tabId: 9,
      url: 'https://example.com/cleanup.txt',
      method: 'GET',
      type: 'xmlhttprequest',
    })

    const filter = fakeBrowser.filters.get('request-3')
    assert.ok(filter)
    const streamFilter = filter

    capture.clear()

    assert.equal(streamFilter.disconnectCalls, 1)
    assert.equal((capture as any).responseFilters.size, 0)
    assert.equal((capture as any).responseStates.size, 0)
    assert.equal((capture as any).requestContexts.size, 0)
    assert.equal((capture as any).pendingResponseFinalizations.size, 0)
  } finally {
    if (originalBrowser === undefined) {
      delete (globalThis as { browser?: unknown }).browser
    } else {
      ;(globalThis as { browser?: unknown }).browser = originalBrowser
    }
  }
})

test('FirefoxNetworkCapture finalizes errors by disconnecting filters and clearing bounded state', async () => {
  const originalBrowser = (globalThis as { browser?: unknown }).browser
  const fakeBrowser = createFakeBrowser()
  ;(globalThis as { browser?: unknown }).browser = fakeBrowser.browser

  const events: Array<Record<string, unknown>> = []
  const capture = new FirefoxNetworkCapture(async (event) => {
    events.push(event as unknown as Record<string, unknown>)
  }, () => true, () => 'session-1')

  try {
    capture.start()

    fakeBrowser.listeners.onBeforeRequest.callback?.({
      requestId: 'request-4',
      tabId: 10,
      url: 'https://example.com/error.txt',
      method: 'GET',
      type: 'xmlhttprequest',
    })

    const filter = fakeBrowser.filters.get('request-4')
    assert.ok(filter)
    const streamFilter = filter

    fakeBrowser.listeners.onErrorOccurred.callback?.({
      requestId: 'request-4',
      tabId: 10,
      url: 'https://example.com/error.txt',
      errorText: 'NS_ERROR_NET_TIMEOUT',
    })
    await Promise.resolve()

    assert.equal(streamFilter.disconnectCalls, 1)
    assert.equal(events.length, 1)
    assert.equal(events[0]?.errorText, 'NS_ERROR_NET_TIMEOUT')
    assert.equal((capture as any).responseFilters.size, 0)
    assert.equal((capture as any).responseStates.size, 0)
    assert.equal((capture as any).requestContexts.size, 0)
    assert.equal((capture as any).pendingResponseFinalizations.size, 0)
  } finally {
    if (originalBrowser === undefined) {
      delete (globalThis as { browser?: unknown }).browser
    } else {
      ;(globalThis as { browser?: unknown }).browser = originalBrowser
    }
  }
})

test('FirefoxNetworkCapture falls back to completion finalization when onCompleted precedes filter failure', async () => {
  const originalBrowser = (globalThis as { browser?: unknown }).browser
  const fakeBrowser = createFakeBrowser()
  ;(globalThis as { browser?: unknown }).browser = fakeBrowser.browser

  const events: Array<Record<string, unknown>> = []
  const capture = new FirefoxNetworkCapture(async (event) => {
    events.push(event as unknown as Record<string, unknown>)
  }, () => true, () => 'session-1')

  try {
    capture.start()

    fakeBrowser.listeners.onBeforeRequest.callback?.({
      requestId: 'request-5',
      tabId: 11,
      url: 'https://example.com/fallback.txt',
      method: 'GET',
      type: 'xmlhttprequest',
    })
    fakeBrowser.listeners.onHeadersReceived.callback?.({
      requestId: 'request-5',
      tabId: 11,
      url: 'https://example.com/fallback.txt',
      method: 'GET',
      type: 'xmlhttprequest',
      mimeType: 'text/plain',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      responseHeaders: [],
    })

    const filter = fakeBrowser.filters.get('request-5')
    assert.ok(filter)
    const streamFilter = filter

    fakeBrowser.listeners.onCompleted.callback?.({ requestId: 'request-5', tabId: 11 })
    await Promise.resolve()

    assert.equal((capture as any).pendingResponseFinalizations.size, 1)
    assert.equal(events.length, 0)

    streamFilter.onerror?.({} as Event)
    await Promise.resolve()

    assert.equal(events.length, 1)
    assert.equal(events[0]?.phase, 'response')
    assert.equal(events[0]?.responseBody, undefined)
    assert.equal((capture as any).responseFilters.size, 0)
    assert.equal((capture as any).responseStates.size, 0)
    assert.equal((capture as any).requestContexts.size, 0)
    assert.equal((capture as any).pendingResponseFinalizations.size, 0)
  } finally {
    if (originalBrowser === undefined) {
      delete (globalThis as { browser?: unknown }).browser
    } else {
      ;(globalThis as { browser?: unknown }).browser = originalBrowser
    }
  }
})

test('FirefoxNetworkCapture completion finalization without a filter clears remaining request state', async () => {
  const events: Array<Record<string, unknown>> = []
  const capture = new FirefoxNetworkCapture(async (event) => {
    events.push(event as unknown as Record<string, unknown>)
  }, () => true, () => 'session-1')

  ;(capture as any).requestContexts.set('12:request-6', {
    startedAt: Date.now(),
    tabId: 12,
    url: 'https://example.com/no-filter.txt',
    method: 'GET',
    resourceType: 'xmlhttprequest',
    status: 204,
    statusText: 'HTTP/1.1 204 No Content',
  })
  ;(capture as any).pendingResponseFinalizations.add('12:request-6')

  await (capture as any).finalizeResponse({ requestId: 'request-6', tabId: 12 })

  assert.equal(events.length, 1)
  assert.equal(events[0]?.status, 204)
  assert.equal((capture as any).responseFilters.size, 0)
  assert.equal((capture as any).responseStates.size, 0)
  assert.equal((capture as any).requestContexts.size, 0)
  assert.equal((capture as any).pendingResponseFinalizations.size, 0)
})

test('FirefoxNetworkCapture keeps response metadata when filter setup fails', async () => {
  const originalBrowser = (globalThis as { browser?: unknown }).browser
  const fakeBrowser = createFakeBrowser({ filterResponseDataThrows: true })
  ;(globalThis as { browser?: unknown }).browser = fakeBrowser.browser

  const events: Array<Record<string, unknown>> = []
  const capture = new FirefoxNetworkCapture(async (event) => {
    events.push(event as unknown as Record<string, unknown>)
  }, () => true, () => 'session-1')

  try {
    capture.start()

    fakeBrowser.listeners.onBeforeRequest.callback?.({
      requestId: 'request-filter-failure',
      tabId: 13,
      url: 'https://example.com/fallback.json',
      method: 'GET',
      type: 'xmlhttprequest',
    })
    fakeBrowser.listeners.onHeadersReceived.callback?.({
      requestId: 'request-filter-failure',
      tabId: 13,
      url: 'https://example.com/fallback.json',
      method: 'GET',
      type: 'xmlhttprequest',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
    })
    fakeBrowser.listeners.onCompleted.callback?.({ requestId: 'request-filter-failure', tabId: 13 })
    await Promise.resolve()

    assert.equal(events.length, 1)
    assert.equal(events[0]?.phase, 'response')
    assert.equal(events[0]?.status, 200)
    assert.equal(events[0]?.mimeType, 'application/json')
    assert.equal(events[0]?.responseBody, undefined)
  } finally {
    if (originalBrowser === undefined) {
      delete (globalThis as { browser?: unknown }).browser
    } else {
      ;(globalThis as { browser?: unknown }).browser = originalBrowser
    }
  }
})
