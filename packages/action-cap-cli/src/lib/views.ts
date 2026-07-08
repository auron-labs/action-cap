import type {
  ActionType,
  NetworkEvent,
  SessionBundle,
  TrackedTabRecord,
  UserActionEvent,
} from '../types.js'
import {
  applyActionFilters,
  applyNetworkFilters,
  byTab,
  byTimeRange,
  withLimit,
  type FilterOptions,
} from './filters.js'

export interface SummaryView {
  session: SessionBundle['session']
  duration: number | null
  tabs: Array<Pick<TrackedTabRecord, 'tabId' | 'windowId' | 'title' | 'url'>>
  timeRange: { start: number; end: number } | null
  counts: {
    tabs: number
    actions: number
    network: number
    replay: number
  }
}

export function sessionSummary(bundle: SessionBundle): SummaryView {
  const session = bundle.session
  const allTimestamps: number[] = [
    ...bundle.userActions.map((a) => a.ts),
    ...bundle.networkEvents.map((n) => n.ts),
    ...bundle.replayEvents.map((r) => r.ts),
  ]
  if (session?.startTime) allTimestamps.push(session.startTime)
  if (session?.endTime) allTimestamps.push(session.endTime)

  const start = allTimestamps.length ? Math.min(...allTimestamps) : undefined
  const end = allTimestamps.length ? Math.max(...allTimestamps) : undefined

  const duration = start !== undefined && end !== undefined ? end - start : null

  return {
    session,
    duration,
    tabs: bundle.tabs.map((t) => ({
      tabId: t.tabId,
      windowId: t.windowId,
      title: t.title,
      url: t.url,
    })),
    timeRange:
      start !== undefined && end !== undefined ? { start, end } : null,
    counts: {
      tabs: bundle.tabs.length,
      actions: bundle.userActions.length,
      network: bundle.networkEvents.length,
      replay: bundle.replayEvents.length,
    },
  }
}

export interface ActionView {
  ts: number
  type: ActionType
  tabId: number
  url?: string
  selector?: string
  tagName?: string
  text?: string
  value?: string
  masked?: boolean
  coordinates?: { x: number; y: number }
  key?: string
}

export function actionTimeline(
  bundle: SessionBundle,
  opts: FilterOptions & { includeScroll?: boolean } = {},
): ActionView[] {
  let actions = bundle.userActions.slice().sort((a, b) => a.ts - b.ts)

  if (!opts.includeScroll) {
    actions = actions.filter((a) => a.type !== 'scroll')
  }

  actions = applyActionFilters(actions, opts)

  return actions.map((a) => ({
    ts: a.ts,
    type: a.type,
    tabId: a.tabId,
    url: a.url,
    selector: a.selector,
    tagName: a.element?.tagName,
    text: a.element?.text,
    value: a.value,
    masked: a.masked,
    coordinates: a.coordinates,
    key: typeof a.metadata?.key === 'string' ? a.metadata.key : undefined,
  }))
}

export interface NetworkView {
  ts: number
  tabId: number
  method?: string
  url: string
  status?: number
  statusText?: string
  mimeType?: string
  resourceType?: string
  durationMs?: number
  requestBody?: string
  responseBody?: string
  errorText?: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  truncated?: boolean
}

function truncate(str: string | undefined, max: number): string | undefined {
  if (str === undefined) return undefined
  if (str.length <= max) return str
  return `${str.slice(0, max)}...[truncated]`
}

export function networkRequests(
  bundle: SessionBundle,
  opts: FilterOptions & { headers?: boolean; truncateLength?: number } = {},
): NetworkView[] {
  let events = bundle.networkEvents.slice().sort((a, b) => a.ts - b.ts)
  events = applyNetworkFilters(events, opts)

  const maxLen = opts.truncateLength ?? 500

  return events.map((e) => ({
    ts: e.ts,
    tabId: e.tabId,
    method: e.method,
    url: e.url,
    status: e.status,
    statusText: e.statusText,
    mimeType: e.mimeType,
    resourceType: e.resourceType,
    durationMs: e.durationMs,
    requestBody: opts.headers ? e.requestBody : truncate(e.requestBody, maxLen),
    responseBody: opts.headers ? e.responseBody : truncate(e.responseBody, maxLen),
    errorText: e.errorText,
    requestHeaders: opts.headers ? e.requestHeaders : undefined,
    responseHeaders: opts.headers ? e.responseHeaders : undefined,
    truncated: e.truncated,
  }))
}

export function networkErrors(bundle: SessionBundle): NetworkView[] {
  const events = bundle.networkEvents
    .filter((e) => (e.status !== undefined && e.status >= 400) || !!e.errorText)
    .sort((a, b) => a.ts - b.ts)

  return events.map((e) => ({
    ts: e.ts,
    tabId: e.tabId,
    method: e.method,
    url: e.url,
    status: e.status,
    statusText: e.statusText,
    mimeType: e.mimeType,
    resourceType: e.resourceType,
    durationMs: e.durationMs,
    requestBody: e.requestBody,
    responseBody: e.responseBody,
    errorText: e.errorText,
    requestHeaders: e.requestHeaders,
    responseHeaders: e.responseHeaders,
    truncated: e.truncated,
  }))
}

export interface EndpointMethodView {
  method: string
  statuses: number[]
  count: number
}

export interface EndpointView {
  path: string
  methods: EndpointMethodView[]
}

export function apiEndpoints(bundle: SessionBundle): { endpoints: EndpointView[] } {
  const endpointMap = new Map<string, Map<string, EndpointMethodView>>()

  for (const e of bundle.networkEvents) {
    if (!e.method) continue
    let path: string
    try {
      path = new URL(e.url).pathname
    } catch {
      path = e.url.split('?')[0]
    }

    if (!endpointMap.has(path)) {
      endpointMap.set(path, new Map())
    }
    const methodMap = endpointMap.get(path)!
    const methodKey = e.method.toUpperCase()

    if (!methodMap.has(methodKey)) {
      methodMap.set(methodKey, { method: methodKey, statuses: [], count: 0 })
    }
    const entry = methodMap.get(methodKey)!
    entry.count++
    if (e.status !== undefined && !entry.statuses.includes(e.status)) {
      entry.statuses.push(e.status)
    }
  }

  const endpoints: EndpointView[] = []
  for (const [path, methodMap] of endpointMap) {
    endpoints.push({
      path,
      methods: [...methodMap.values()].sort((a, b) => a.method.localeCompare(b.method)),
    })
  }

  endpoints.sort((a, b) => a.path.localeCompare(b.path))
  return { endpoints }
}

export interface FormView {
  ts: number
  tabId: number
  url?: string
  selector?: string
  formValues: Array<{
    selector?: string
    tagName?: string
    name?: string
    value?: string
    masked?: boolean
  }>
}

export function formSubmissions(bundle: SessionBundle): FormView[] {
  const actions = bundle.userActions.slice().sort((a, b) => a.ts - b.ts)
  const submits = actions.filter((a) => a.type === 'submit')

  return submits.map((submit) => {
    const precedingInputs = actions.filter(
      (a) =>
        a.ts <= submit.ts &&
        a.tabId === submit.tabId &&
        (a.type === 'input' || a.type === 'change') &&
        a.value !== undefined,
    )

    const formValues = precedingInputs.map((a) => ({
      selector: a.selector,
      tagName: a.element?.tagName,
      name: a.element?.name,
      value: a.value,
      masked: a.masked,
    }))

    return {
      ts: submit.ts,
      tabId: submit.tabId,
      url: submit.url,
      selector: submit.selector,
      formValues,
    }
  })
}

export interface NavigationView {
  ts: number
  type: string
  tabId: number
  url?: string
  title?: string
}

export function navigationFlow(bundle: SessionBundle): { navigations: NavigationView[] } {
  const navTypes = new Set(['navigation', 'tab-activated', 'tab-created', 'tab-removed', 'window-focus'])
  const navigations = bundle.userActions
    .filter((a) => navTypes.has(a.type))
    .sort((a, b) => a.ts - b.ts)
    .map((a) => ({
      ts: a.ts,
      type: a.type,
      tabId: a.tabId,
      url: a.url,
      title: a.title,
    }))

  return { navigations }
}

export interface ElementInteractionView {
  type: string
  count: number
}

export interface ElementView {
  selector: string
  tagName?: string
  text?: string
  role?: string
  name?: string
  interactions: ElementInteractionView[]
}

export function interactedElements(bundle: SessionBundle): { elements: ElementView[] } {
  const interactionTypes = new Set(['click', 'dblclick', 'contextmenu', 'input', 'change', 'submit', 'keydown', 'keyup', 'focus', 'blur'])
  const elementMap = new Map<string, ElementView>()

  for (const a of bundle.userActions) {
    if (!interactionTypes.has(a.type)) continue
    const key = a.selector ?? `<${a.element?.tagName ?? 'unknown'}>`
    if (!elementMap.has(key)) {
      elementMap.set(key, {
        selector: key,
        tagName: a.element?.tagName,
        text: a.element?.text,
        role: a.element?.role,
        name: a.element?.name,
        interactions: [],
      })
    }
    const entry = elementMap.get(key)!
    const existing = entry.interactions.find((i) => i.type === a.type)
    if (existing) {
      existing.count++
    } else {
      entry.interactions.push({ type: a.type, count: 1 })
    }
  }

  const elements = [...elementMap.values()]
  elements.sort((a, b) => {
    const aTotal = a.interactions.reduce((s, i) => s + i.count, 0)
    const bTotal = b.interactions.reduce((s, i) => s + i.count, 0)
    return bTotal - aTotal
  })

  return { elements }
}

export interface TabView {
  tabId: number
  windowId: number
  title?: string
  url?: string
  firstSeenAt: number
  lastSeenAt: number
  events: Array<{ ts: number; type: string; url?: string; title?: string }>
}

export function tabLifecycle(bundle: SessionBundle): { tabs: TabView[] } {
  const lifecycleTypes = new Set(['tab-activated', 'tab-created', 'tab-removed', 'window-focus', 'navigation'])
  const tabMap = new Map<number, TabView>()

  for (const tab of bundle.tabs) {
    tabMap.set(tab.tabId, {
      tabId: tab.tabId,
      windowId: tab.windowId,
      title: tab.title,
      url: tab.url,
      firstSeenAt: tab.firstSeenAt,
      lastSeenAt: tab.lastSeenAt,
      events: [],
    })
  }

  for (const a of bundle.userActions) {
    if (!lifecycleTypes.has(a.type)) continue
    if (!tabMap.has(a.tabId)) {
      tabMap.set(a.tabId, {
        tabId: a.tabId,
        windowId: 0,
        firstSeenAt: a.ts,
        lastSeenAt: a.ts,
        events: [],
      })
    }
    tabMap.get(a.tabId)!.events.push({
      ts: a.ts,
      type: a.type,
      url: a.url,
      title: a.title,
    })
  }

  const tabs = [...tabMap.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt)
  return { tabs }
}

export interface ReplayView {
  count: number
  timeRange: { start: number; end: number } | null
  estimatedSizeBytes: number
  events?: unknown[]
}

export function replayMetadata(
  bundle: SessionBundle,
  opts: { full?: boolean } = {},
): ReplayView {
  const events = bundle.replayEvents.slice().sort((a, b) => a.ts - b.ts)
  if (events.length === 0) {
    return { count: 0, timeRange: null, estimatedSizeBytes: 0 }
  }

  const start = events[0].ts
  const end = events[events.length - 1].ts
  const estimatedSizeBytes = events.reduce((sum, e) => {
    return sum + Buffer.byteLength(JSON.stringify(e.payload), 'utf8')
  }, 0)

  return {
    count: events.length,
    timeRange: { start, end },
    estimatedSizeBytes,
    ...(opts.full ? { events: events.map((e) => e.payload) } : {}),
  }
}

export function fullDump(bundle: SessionBundle, opts: { noReplay?: boolean } = {}): SessionBundle {
  if (opts.noReplay) {
    return {
      ...bundle,
      replayEvents: [],
    }
  }
  return bundle
}
