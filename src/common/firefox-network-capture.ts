import { isProbablyTextMimeType, mergeHeaders, sanitizeHeaders, truncateBody } from './sanitizer'
import type { NetworkEvent } from './types'

type RequestContext = {
  startedAt: number
  tabId: number
  url: string
  method?: string
  requestHeaders?: Record<string, string>
  requestBody?: string
  resourceType?: string
  initiator?: string
  status?: number
  statusText?: string
  responseHeaders?: Record<string, string>
  mimeType?: string
}

type ResponseCaptureState = {
  chunks: Uint8Array[]
  capturedBytes: number
  retainBody: boolean
  truncated: boolean
}

type NetworkEventCallback = (event: NetworkEvent) => Promise<void>

type FirefoxHeader = { name: string; value?: string; binaryValue?: number[] }

type FirefoxWebRequestDetails = {
  requestId: string
  url: string
  method: string
  tabId: number
  type: string
  initiator?: string
  originUrl?: string
  documentUrl?: string
  requestBody?: {
    error?: string
    formData?: Record<string, string[]>
    raw?: Array<{ bytes?: ArrayBuffer; file?: string }>
  }
  requestHeaders?: FirefoxHeader[]
}

type FirefoxResponseDetails = FirefoxWebRequestDetails & {
  statusCode?: number
  statusLine?: string
  responseHeaders?: FirefoxHeader[]
  mimeType?: string
}

type FirefoxCompleteDetails = {
  requestId: string
  tabId: number
  url?: string
  errorText?: string
}

type FirefoxStreamFilter = {
  onstart: ((event: Event) => void) | null
  ondata: ((event: { data: ArrayBuffer }) => void) | null
  onstop: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  write(data: ArrayBuffer | Uint8Array): void
  disconnect(): void
  close(): void
}

type FirefoxWebRequest = {
  onBeforeRequest: {
    addListener(
      callback: (details: FirefoxWebRequestDetails) => void,
      filter: { urls: string[]; types?: string[] },
      extraInfoSpec?: string[],
    ): void
  }
  onSendHeaders: {
    addListener(
      callback: (details: FirefoxWebRequestDetails) => void,
      filter: { urls: string[]; types?: string[] },
      extraInfoSpec?: string[],
    ): void
  }
  onHeadersReceived: {
    addListener(
      callback: (details: FirefoxResponseDetails) => void,
      filter: { urls: string[]; types?: string[] },
      extraInfoSpec?: string[],
    ): void
  }
  onCompleted: {
    addListener(
      callback: (details: FirefoxCompleteDetails) => void,
      filter: { urls: string[]; types?: string[] },
    ): void
  }
  onErrorOccurred: {
    addListener(
      callback: (details: FirefoxCompleteDetails) => void,
      filter: { urls: string[]; types?: string[] },
    ): void
  }
  filterResponseData(requestId: string): FirefoxStreamFilter
}

type FirefoxBrowser = {
  webRequest: FirefoxWebRequest
}

function getFirefoxBrowser(): FirefoxBrowser {
  return (globalThis as unknown as { browser: FirefoxBrowser }).browser
}

function headersToRecord(headers: FirefoxHeader[] | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  const result: Record<string, string> = {}
  for (const header of headers) {
    if (header.binaryValue) {
      try {
        result[header.name] = new TextDecoder().decode(new Uint8Array(header.binaryValue))
      } catch {
        result[header.name] = '[binary]'
      }
    } else {
      result[header.name] = header.value ?? ''
    }
  }
  return result
}

function decodeRequestBody(details: FirefoxWebRequestDetails): string | undefined {
  if (!details.requestBody) return undefined

  if (details.requestBody.formData) {
    const params = new URLSearchParams()
    for (const [key, values] of Object.entries(details.requestBody.formData)) {
      for (const value of values) {
        params.append(key, value)
      }
    }
    return params.toString()
  }

  if (details.requestBody.raw?.length) {
    const chunks: string[] = []
    for (const item of details.requestBody.raw) {
      if (item.bytes) {
        try {
          chunks.push(new TextDecoder().decode(item.bytes))
        } catch {
          chunks.push('[binary]')
        }
      }
    }
    return chunks.join('')
  }

  return undefined
}

const MAX_RESPONSE_BODY_LENGTH = 1_000_000

export function createResponseCaptureState(): ResponseCaptureState {
  return {
    chunks: [],
    capturedBytes: 0,
    retainBody: true,
    truncated: false,
  }
}

export function captureResponseChunk(
  state: ResponseCaptureState,
  chunk: Uint8Array,
  maxBytes = MAX_RESPONSE_BODY_LENGTH,
) {
  if (!state.retainBody || chunk.length === 0) {
    return
  }

  const remainingBytes = maxBytes - state.capturedBytes
  if (remainingBytes <= 0) {
    state.truncated = true
    return
  }

  if (chunk.length > remainingBytes) {
    state.chunks.push(chunk.slice(0, remainingBytes))
    state.capturedBytes += remainingBytes
    state.truncated = true
    return
  }

  state.chunks.push(chunk)
  state.capturedBytes += chunk.length
}

export function disableResponseBodyRetention(state: ResponseCaptureState) {
  state.chunks = []
  state.capturedBytes = 0
  state.truncated = true
  state.retainBody = false
}

export class FirefoxNetworkCapture {
  private requestContexts = new Map<string, RequestContext>()
  private responseFilters = new Map<string, FirefoxStreamFilter>()
  private responseStates = new Map<string, ResponseCaptureState>()
  private pendingResponseFinalizations = new Set<string>()
  private recordNetworkEvent: NetworkEventCallback
  private isTabTracked: (tabId: number) => boolean
  private getSessionId: () => string | null

  constructor(
    recordNetworkEvent: NetworkEventCallback,
    isTabTracked: (tabId: number) => boolean,
    getSessionId: () => string | null,
  ) {
    this.recordNetworkEvent = recordNetworkEvent
    this.isTabTracked = isTabTracked
    this.getSessionId = getSessionId
  }

  private getOrCreateContext(key: string, tabId: number) {
    const existing = this.requestContexts.get(key)
    if (existing) return existing

    const created: RequestContext = { startedAt: Date.now(), tabId, url: '' }
    this.requestContexts.set(key, created)
    return created
  }

  start() {
    const browser = getFirefoxBrowser()
    const filter = { urls: ['<all_urls>'] }

    browser.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (!this.isTabTracked(details.tabId) || details.tabId < 0) return

        const sessionId = this.getSessionId()
        if (!sessionId) return

        const key = `${details.tabId}:${details.requestId}`
        const context = this.getOrCreateContext(key, details.tabId)
        context.startedAt = Date.now()
        context.url = details.url
        context.method = details.method
        context.resourceType = details.type
        context.initiator = details.initiator ?? details.originUrl

        const requestBody = decodeRequestBody(details)
        const truncated = truncateBody(requestBody)
        context.requestBody = truncated.body

        this.setupResponseFilter(details.requestId, details.tabId)
      },
      filter,
      ['requestBody'],
    )

    browser.webRequest.onSendHeaders.addListener(
      (details) => {
        if (!this.isTabTracked(details.tabId) || details.tabId < 0) return

        const sessionId = this.getSessionId()
        if (!sessionId) return

        const key = `${details.tabId}:${details.requestId}`
        const context = this.getOrCreateContext(key, details.tabId)
        const sanitized = sanitizeHeaders(headersToRecord(details.requestHeaders))
        context.requestHeaders = mergeHeaders(context.requestHeaders, sanitized)

        this.recordNetworkEvent({
          id: crypto.randomUUID(),
          sessionId,
          tabId: details.tabId,
          requestId: details.requestId,
          ts: Date.now(),
          phase: 'request',
          url: details.url,
          method: details.method,
          resourceType: details.type,
          requestHeaders: context.requestHeaders,
          requestBody: context.requestBody,
          initiator: context.initiator,
          truncated: context.requestBody !== undefined && context.requestBody.length > 1_000_000,
        })
      },
      filter,
      ['requestHeaders'],
    )

    browser.webRequest.onHeadersReceived.addListener(
      (details) => {
        if (!this.isTabTracked(details.tabId) || details.tabId < 0) return

        const key = `${details.tabId}:${details.requestId}`
        const context = this.getOrCreateContext(key, details.tabId)

        context.status = details.statusCode
        context.statusText = details.statusLine
        context.responseHeaders = mergeHeaders(
          context.responseHeaders,
          sanitizeHeaders(headersToRecord(details.responseHeaders)),
        )
        if (details.mimeType) {
          context.mimeType = details.mimeType

          const captureState = this.responseStates.get(key)
          if (captureState && !isProbablyTextMimeType(details.mimeType)) {
            disableResponseBodyRetention(captureState)
          }
        }
      },
      filter,
      ['responseHeaders'],
    )

    browser.webRequest.onCompleted.addListener(
      (details) => {
        void this.finalizeResponse(details)
      },
      filter,
    )

    browser.webRequest.onErrorOccurred.addListener(
      (details) => {
        void this.finalizeError(details)
      },
      filter,
    )
  }

  private setupResponseFilter(requestId: string, tabId: number) {
    const key = `${tabId}:${requestId}`
    if (this.responseFilters.has(key)) return

    const browser = getFirefoxBrowser()
    const streamFilter = browser.webRequest.filterResponseData(requestId)
    this.responseFilters.set(key, streamFilter)
    this.responseStates.set(key, createResponseCaptureState())

    streamFilter.ondata = (event) => {
      streamFilter.write(event.data)

      const state = this.responseStates.get(key)
      if (!state) {
        return
      }

      if (!state.retainBody) {
        return
      }

      captureResponseChunk(state, new Uint8Array(event.data))
    }

    streamFilter.onstop = () => {
      this.pendingResponseFinalizations.delete(key)
      void this.emitResponse(key, tabId, requestId)
    }

    streamFilter.onerror = () => {
      this.responseFilters.delete(key)
      this.responseStates.delete(key)

      if (this.pendingResponseFinalizations.delete(key)) {
        void this.finalizeResponse({ requestId, tabId })
      }
    }
  }

  private async emitResponse(key: string, tabId: number, requestId: string) {
    const streamFilter = this.responseFilters.get(key)
    const captureState = this.responseStates.get(key)
    const context = this.requestContexts.get(key)

    this.responseFilters.delete(key)
    this.responseStates.delete(key)

    if (streamFilter) {
      streamFilter.close()
    }

    if (!context) return

    const sessionId = this.getSessionId()
    if (!sessionId) return

    let responseBody: string | undefined
    let truncated = false
    let bodyEncoding: 'plain' | 'base64' = 'plain'

    if (isProbablyTextMimeType(context.mimeType)) {
      try {
        if (captureState && captureState.chunks.length > 0) {
          const combined = combineUint8Arrays(captureState.chunks)
          responseBody = new TextDecoder().decode(combined)
          truncated = captureState.truncated
        }
      } catch {
        responseBody = '[failed to decode response body]'
      }
    } else {
      responseBody = `[binary ${context.mimeType ?? 'unknown'} omitted]`
      truncated = true
    }

    await this.recordNetworkEvent({
      id: crypto.randomUUID(),
      sessionId,
      tabId,
      requestId,
      ts: Date.now(),
      phase: 'response',
      url: context.url,
      method: context.method,
      status: context.status,
      statusText: context.statusText,
      resourceType: context.resourceType,
      mimeType: context.mimeType,
      requestHeaders: context.requestHeaders,
      responseHeaders: context.responseHeaders,
      requestBody: context.requestBody,
      responseBody,
      bodyEncoding,
      durationMs: Date.now() - context.startedAt,
      initiator: context.initiator,
      truncated,
    })

    this.requestContexts.delete(key)
  }

  private async finalizeResponse(details: FirefoxCompleteDetails) {
    const key = `${details.tabId}:${details.requestId}`
    const context = this.requestContexts.get(key)

    if (this.responseFilters.has(key)) {
      // The stream filter will handle emitting the response via onstop
      this.pendingResponseFinalizations.add(key)
      return
    }

    this.pendingResponseFinalizations.delete(key)

    if (!context) return

    const sessionId = this.getSessionId()
    if (!sessionId) return

    await this.recordNetworkEvent({
      id: crypto.randomUUID(),
      sessionId,
      tabId: details.tabId,
      requestId: details.requestId,
      ts: Date.now(),
      phase: 'response',
      url: context.url,
      method: context.method,
      status: context.status,
      statusText: context.statusText,
      resourceType: context.resourceType,
      mimeType: context.mimeType,
      requestHeaders: context.requestHeaders,
      responseHeaders: context.responseHeaders,
      requestBody: context.requestBody,
      durationMs: Date.now() - context.startedAt,
      initiator: context.initiator,
    })

    this.requestContexts.delete(key)
  }

  private async finalizeError(details: FirefoxCompleteDetails) {
    const key = `${details.tabId}:${details.requestId}`
    const context = this.requestContexts.get(key)
    const streamFilter = this.responseFilters.get(key)
    this.pendingResponseFinalizations.delete(key)

    if (streamFilter) {
      streamFilter.disconnect()
      this.responseFilters.delete(key)
      this.responseStates.delete(key)
    }

    if (!context) return

    const sessionId = this.getSessionId()
    if (!sessionId) return

    await this.recordNetworkEvent({
      id: crypto.randomUUID(),
      sessionId,
      tabId: details.tabId,
      requestId: details.requestId,
      ts: Date.now(),
      phase: 'response',
      url: context.url ?? details.url ?? '',
      method: context.method,
      resourceType: context.resourceType,
      requestHeaders: context.requestHeaders,
      requestBody: context.requestBody,
      errorText: details.errorText,
      durationMs: Date.now() - context.startedAt,
      initiator: context.initiator,
    })

    this.requestContexts.delete(key)
  }

  clear() {
    // Firefox webRequest listeners stay registered for the extension lifetime.
    // Stopping a recording only needs to drop in-flight per-request state so
    // later listener callbacks cannot flush stale data into the next session.
    for (const [, streamFilter] of this.responseFilters) {
      try {
        streamFilter.disconnect()
      } catch {
        // ignore
      }
    }
    this.responseFilters.clear()
    this.responseStates.clear()
    this.pendingResponseFinalizations.clear()
    this.requestContexts.clear()
  }
}

function combineUint8Arrays(buffers: Uint8Array[]): Uint8Array {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const buf of buffers) {
    combined.set(buf, offset)
    offset += buf.length
  }
  return combined
}
