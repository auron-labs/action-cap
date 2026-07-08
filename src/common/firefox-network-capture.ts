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
      callback: (details: FirefoxWebRequestDetails) => void | object,
      filter: { urls: string[]; types?: string[] },
      extraInfoSpec?: string[],
    ): void
  }
  onBeforeSendHeaders: {
    addListener(
      callback: (details: FirefoxWebRequestDetails) => void | object,
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
      callback: (details: FirefoxResponseDetails) => void | object,
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
const activeResponseFilters = new Map<string, FirefoxStreamFilter>()

export class FirefoxNetworkCapture {
  private requestContexts = new Map<string, RequestContext>()
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

        const shouldFilterResponse = true

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
          requestHeaders: undefined,
          requestBody: truncated.body,
          initiator: context.initiator,
          truncated: truncated.truncated,
        })

        if (shouldFilterResponse) {
          this.setupResponseFilter(details.requestId, details.tabId)
        }

        return {}
      },
      filter,
      ['requestBody'],
    )

    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        if (!this.isTabTracked(details.tabId) || details.tabId < 0) return

        const key = `${details.tabId}:${details.requestId}`
        const context = this.getOrCreateContext(key, details.tabId)
        const sanitized = sanitizeHeaders(headersToRecord(details.requestHeaders))
        context.requestHeaders = mergeHeaders(context.requestHeaders, sanitized)
        return {}
      },
      filter,
      ['requestHeaders', 'blocking'],
    )

    browser.webRequest.onSendHeaders.addListener(
      (details) => {
        if (!this.isTabTracked(details.tabId) || details.tabId < 0) return

        const key = `${details.tabId}:${details.requestId}`
        const context = this.getOrCreateContext(key, details.tabId)
        const sanitized = sanitizeHeaders(headersToRecord(details.requestHeaders))
        context.requestHeaders = mergeHeaders(context.requestHeaders, sanitized)
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
        }
        return {}
      },
      filter,
      ['responseHeaders', 'blocking'],
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

  private responseBuffers = new Map<string, Uint8Array[]>()

  private setupResponseFilter(requestId: string, tabId: number) {
    const key = `${tabId}:${requestId}`
    if (activeResponseFilters.has(key)) return

    const browser = getFirefoxBrowser()
    const filter = browser.webRequest.filterResponseData(requestId)
    activeResponseFilters.set(key, filter)
    this.responseBuffers.set(key, [])

    filter.ondata = (event) => {
      const buffers = this.responseBuffers.get(key)
      if (buffers) {
        buffers.push(new Uint8Array(event.data))
      }
    }

    filter.onstop = () => {
      void this.emitResponse(key, tabId, requestId)
    }

    filter.onerror = () => {
      activeResponseFilters.delete(key)
      this.responseBuffers.delete(key)
    }
  }

  private async emitResponse(key: string, tabId: number, requestId: string) {
    const filter = activeResponseFilters.get(key)
    const buffers = this.responseBuffers.get(key)
    const context = this.requestContexts.get(key)

    activeResponseFilters.delete(key)
    this.responseBuffers.delete(key)

    if (filter) {
      if (buffers && buffers.length > 0) {
        const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
        const passthrough = new Uint8Array(totalLength)
        let offset = 0
        for (const buf of buffers) {
          passthrough.set(buf, offset)
          offset += buf.length
        }
        filter.write(passthrough)
      }
      filter.close()
    }

    if (!context) return

    const sessionId = this.getSessionId()
    if (!sessionId) return

    let responseBody: string | undefined
    let truncated = false
    let bodyEncoding: 'plain' | 'base64' = 'plain'

    if (isProbablyTextMimeType(context.mimeType)) {
      try {
        if (buffers && buffers.length > 0) {
          const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
          const combined = new Uint8Array(totalLength)
          let offset = 0
          for (const buf of buffers) {
            combined.set(buf, offset)
            offset += buf.length
          }
          const decoded = new TextDecoder().decode(combined)
          const truncatedBody = truncateBody(decoded, MAX_RESPONSE_BODY_LENGTH)
          responseBody = truncatedBody.body
          truncated = truncatedBody.truncated
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
    const filter = activeResponseFilters.get(key)

    if (filter) {
      // The stream filter will handle emitting the response via onstop
      return
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
    const filter = activeResponseFilters.get(key)

    if (filter) {
      filter.disconnect()
      activeResponseFilters.delete(key)
      this.responseBuffers.delete(key)
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
    for (const [, filter] of activeResponseFilters) {
      try {
        filter.disconnect()
      } catch {
        // ignore
      }
    }
    activeResponseFilters.clear()
    this.responseBuffers.clear()
    this.requestContexts.clear()
  }
}
