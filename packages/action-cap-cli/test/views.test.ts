import { readFileSync } from 'node:fs'
import { resolve } from 'pathe'
import { expect, test, describe, beforeEach } from 'bun:test'
import { parseArchive } from '../src/lib/archive.js'
import type { SessionBundle } from '../src/types.js'

const fixturePath = resolve(import.meta.dir, 'fixtures/sample.bxdac')
const fixtureRaw = JSON.parse(readFileSync(fixturePath, 'utf8'))

let bundle: SessionBundle

beforeEach(() => {
  bundle = parseArchive(structuredClone(fixtureRaw))
})

describe('archive reader', () => {
  test('parses valid archive', () => {
    expect(bundle.session?.id).toBe('sess-001')
    expect(bundle.tabs).toHaveLength(2)
    expect(bundle.userActions).toHaveLength(8)
    expect(bundle.networkEvents).toHaveLength(5)
    expect(bundle.replayEvents).toHaveLength(3)
  })

  test('throws on invalid format', () => {
    expect(() => parseArchive({ format: 'wrong', version: 1, bundle: {} })).toThrow()
  })

  test('throws on wrong version', () => {
    expect(() => parseArchive({ format: 'actioncap-session-archive', version: 2, bundle: {} })).toThrow()
  })

  test('throws on missing bundle', () => {
    expect(() => parseArchive({ format: 'actioncap-session-archive', version: 1 })).toThrow()
  })
})

describe('sessionSummary', () => {
  test('returns session metadata and counts', async () => {
    const { sessionSummary } = await import('../src/lib/views.js')
    const view = sessionSummary(bundle)

    expect(view.session?.id).toBe('sess-001')
    expect(view.duration).toBe(60000)
    expect(view.counts.tabs).toBe(2)
    expect(view.counts.actions).toBe(8)
    expect(view.counts.network).toBe(5)
    expect(view.counts.replay).toBe(3)
    expect(view.tabs).toHaveLength(2)
    expect(view.timeRange).not.toBeNull()
  })
})

describe('actionTimeline', () => {
  test('excludes scroll events by default', async () => {
    const { actionTimeline } = await import('../src/lib/views.js')
    const view = actionTimeline(bundle)
    expect(view).toHaveLength(7)
    expect(view.find((a) => a.type === 'scroll')).toBeUndefined()
  })

  test('includes scroll events with flag', async () => {
    const { actionTimeline } = await import('../src/lib/views.js')
    const view = actionTimeline(bundle, { includeScroll: true })
    expect(view).toHaveLength(8)
    expect(view.find((a) => a.type === 'scroll')).toBeDefined()
  })

  test('filters by tab', async () => {
    const { actionTimeline } = await import('../src/lib/views.js')
    const view = actionTimeline(bundle, { tab: 200 })
    expect(view).toHaveLength(0)
  })

  test('filters by type', async () => {
    const { actionTimeline } = await import('../src/lib/views.js')
    const view = actionTimeline(bundle, { type: 'click' })
    expect(view).toHaveLength(1)
    expect(view[0].type).toBe('click')
  })

  test('maps element fields correctly', async () => {
    const { actionTimeline } = await import('../src/lib/views.js')
    const view = actionTimeline(bundle, { type: 'click' })
    expect(view[0].tagName).toBe('input')
    expect(view[0].text).toBe('')
  })

  test('preserves masked flag', async () => {
    const { actionTimeline } = await import('../src/lib/views.js')
    const view = actionTimeline(bundle, { type: 'input' })
    const masked = view.find((a) => a.masked === true)
    expect(masked).toBeDefined()
    expect(masked?.value).toBe('al***ab')
  })
})

describe('networkRequests', () => {
  test('returns all network events sorted by ts', async () => {
    const { networkRequests } = await import('../src/lib/views.js')
    const view = networkRequests(bundle)
    expect(view).toHaveLength(5)
    expect(view[0].ts).toBeLessThanOrEqual(view[1].ts)
  })

  test('truncates response body by default', async () => {
    const { networkRequests } = await import('../src/lib/views.js')
    const view = networkRequests(bundle, { truncateLength: 10 })
    const withBody = view.find((e) => e.responseBody && e.responseBody.length > 13)
    expect(withBody).toBeDefined()
    expect(withBody?.responseBody).toContain('...[truncated]')
  })

  test('filters by status range', async () => {
    const { networkRequests } = await import('../src/lib/views.js')
    const view = networkRequests(bundle, { status: '4xx' })
    expect(view).toHaveLength(1)
    expect(view[0].status).toBe(401)
  })

  test('includes headers when requested', async () => {
    const { networkRequests } = await import('../src/lib/views.js')
    const view = networkRequests(bundle, { headers: true })
    expect(view[0].requestHeaders).toBeDefined()
  })

  test('excludes headers by default', async () => {
    const { networkRequests } = await import('../src/lib/views.js')
    const view = networkRequests(bundle)
    expect(view[0].requestHeaders).toBeUndefined()
  })
})

describe('networkErrors', () => {
  test('returns only failed requests', async () => {
    const { networkErrors } = await import('../src/lib/views.js')
    const view = networkErrors(bundle)
    expect(view).toHaveLength(2)
    expect(view.every((e) => (e.status && e.status >= 400) || e.errorText)).toBe(true)
  })

  test('includes full response bodies', async () => {
    const { networkErrors } = await import('../src/lib/views.js')
    const view = networkErrors(bundle)
    const error401 = view.find((e) => e.status === 401)
    expect(error401?.responseBody).toBe('{"error":"Invalid credentials"}')
  })
})

describe('apiEndpoints', () => {
  test('deduplicates endpoints by path', async () => {
    const { apiEndpoints } = await import('../src/lib/views.js')
    const { endpoints } = apiEndpoints(bundle)
    const authEndpoint = endpoints.find((e) => e.path === '/auth')
    expect(authEndpoint).toBeDefined()
    expect(authEndpoint?.methods).toHaveLength(1)
    expect(authEndpoint?.methods[0].count).toBe(2)
  })

  test('strips query strings', async () => {
    const { apiEndpoints } = await import('../src/lib/views.js')
    const { endpoints } = apiEndpoints(bundle)
    const usersEndpoint = endpoints.find((e) => e.path === '/users')
    expect(usersEndpoint).toBeDefined()
    expect(usersEndpoint?.methods[0].count).toBe(2)
  })

  test('collects unique status codes', async () => {
    const { apiEndpoints } = await import('../src/lib/views.js')
    const { endpoints } = apiEndpoints(bundle)
    const usersEndpoint = endpoints.find((e) => e.path === '/users')
    expect(usersEndpoint?.methods[0].statuses).toContain(200)
    expect(usersEndpoint?.methods[0].statuses).toContain(500)
  })
})

describe('formSubmissions', () => {
  test('returns submit events with preceding input values', async () => {
    const { formSubmissions } = await import('../src/lib/views.js')
    const view = formSubmissions(bundle)
    expect(view).toHaveLength(1)
    expect(view[0].formValues).toHaveLength(2)
    const username = view[0].formValues.find((v) => v.selector === '#username')
    expect(username?.value).toBe('alice')
  })

  test('preserves masked flag on form values', async () => {
    const { formSubmissions } = await import('../src/lib/views.js')
    const view = formSubmissions(bundle)
    const password = view[0].formValues.find((v) => v.selector === '#password')
    expect(password?.masked).toBe(true)
  })
})

describe('navigationFlow', () => {
  test('returns navigation and tab lifecycle events', async () => {
    const { navigationFlow } = await import('../src/lib/views.js')
    const { navigations } = navigationFlow(bundle)
    expect(navigations).toHaveLength(3)
    expect(navigations[0].type).toBe('navigation')
    expect(navigations[1].type).toBe('navigation')
    expect(navigations[2].type).toBe('tab-created')
  })

  test('events are chronological', async () => {
    const { navigationFlow } = await import('../src/lib/views.js')
    const { navigations } = navigationFlow(bundle)
    for (let i = 1; i < navigations.length; i++) {
      expect(navigations[i].ts).toBeGreaterThanOrEqual(navigations[i - 1].ts)
    }
  })
})

describe('interactedElements', () => {
  test('deduplicates by selector', async () => {
    const { interactedElements } = await import('../src/lib/views.js')
    const { elements } = interactedElements(bundle)
    const usernameEl = elements.find((e) => e.selector === '#username')
    expect(usernameEl).toBeDefined()
    expect(usernameEl?.interactions).toHaveLength(2)
    const click = usernameEl?.interactions.find((i) => i.type === 'click')
    const input = usernameEl?.interactions.find((i) => i.type === 'input')
    expect(click?.count).toBe(1)
    expect(input?.count).toBe(1)
  })

  test('excludes scroll events', async () => {
    const { interactedElements } = await import('../src/lib/views.js')
    const { elements } = interactedElements(bundle)
    expect(elements.find((e) => e.selector?.includes('scroll'))).toBeUndefined()
  })

  test('sorts by interaction count descending', async () => {
    const { interactedElements } = await import('../src/lib/views.js')
    const { elements } = interactedElements(bundle)
    for (let i = 1; i < elements.length; i++) {
      const prevTotal = elements[i - 1].interactions.reduce((s, x) => s + x.count, 0)
      const currTotal = elements[i].interactions.reduce((s, x) => s + x.count, 0)
      expect(prevTotal).toBeGreaterThanOrEqual(currTotal)
    }
  })
})

describe('tabLifecycle', () => {
  test('returns tab records with lifecycle events', async () => {
    const { tabLifecycle } = await import('../src/lib/views.js')
    const { tabs } = tabLifecycle(bundle)
    expect(tabs).toHaveLength(2)
    const tab100 = tabs.find((t) => t.tabId === 100)
    expect(tab100?.events).toHaveLength(3)
  })

  test('creates tab entries for actions on untracked tabs', async () => {
    const { tabLifecycle } = await import('../src/lib/views.js')
    const { tabs } = tabLifecycle(bundle)
    expect(tabs.length).toBeGreaterThanOrEqual(2)
  })
})

describe('replayMetadata', () => {
  test('returns count and time range', async () => {
    const { replayMetadata } = await import('../src/lib/views.js')
    const view = replayMetadata(bundle)
    expect(view.count).toBe(3)
    expect(view.timeRange).not.toBeNull()
    expect(view.estimatedSizeBytes).toBeGreaterThan(0)
  })

  test('does not include events by default', async () => {
    const { replayMetadata } = await import('../src/lib/views.js')
    const view = replayMetadata(bundle)
    expect(view.events).toBeUndefined()
  })

  test('includes events with full flag', async () => {
    const { replayMetadata } = await import('../src/lib/views.js')
    const view = replayMetadata(bundle, { full: true })
    expect(view.events).toBeDefined()
    expect(view.events).toHaveLength(3)
  })

  test('handles empty replay events', async () => {
    const { replayMetadata } = await import('../src/lib/views.js')
    const view = replayMetadata({ ...bundle, replayEvents: [] })
    expect(view.count).toBe(0)
    expect(view.timeRange).toBeNull()
  })
})

describe('fullDump', () => {
  test('returns complete bundle by default', async () => {
    const { fullDump } = await import('../src/lib/views.js')
    const view = fullDump(bundle)
    expect(view.replayEvents).toHaveLength(3)
    expect(view.userActions).toHaveLength(8)
  })

  test('excludes replay with no-replay flag', async () => {
    const { fullDump } = await import('../src/lib/views.js')
    const view = fullDump(bundle, { noReplay: true })
    expect(view.replayEvents).toHaveLength(0)
    expect(view.userActions).toHaveLength(8)
  })
})

describe('filters', () => {
  test('byTab filters by tabId', async () => {
    const { byTab } = await import('../src/lib/filters.js')
    const result = byTab(bundle.networkEvents, 200)
    expect(result).toHaveLength(2)
    expect(result.every((e) => e.tabId === 200)).toBe(true)
  })

  test('byType filters by event type', async () => {
    const { byType } = await import('../src/lib/filters.js')
    const result = byType(bundle.userActions, 'click,input')
    expect(result).toHaveLength(3)
  })

  test('byStatus parses 4xx range', async () => {
    const { byStatus, parseStatusFilter } = await import('../src/lib/filters.js')
    expect(parseStatusFilter('4xx')(400)).toBe(true)
    expect(parseStatusFilter('4xx')(499)).toBe(true)
    expect(parseStatusFilter('4xx')(500)).toBe(false)
    expect(byStatus(bundle.networkEvents, '4xx')).toHaveLength(1)
  })

  test('byStatus parses exact code', async () => {
    const { parseStatusFilter } = await import('../src/lib/filters.js')
    expect(parseStatusFilter('200')(200)).toBe(true)
    expect(parseStatusFilter('200')(201)).toBe(false)
  })

  test('byStatus parses >=400', async () => {
    const { parseStatusFilter } = await import('../src/lib/filters.js')
    expect(parseStatusFilter('>=400')(400)).toBe(true)
    expect(parseStatusFilter('>=400')(399)).toBe(false)
    expect(parseStatusFilter('>=400')(500)).toBe(true)
  })

  test('byStatus throws on invalid filter', async () => {
    const { parseStatusFilter } = await import('../src/lib/filters.js')
    expect(() => parseStatusFilter('invalid')).toThrow()
  })

  test('byTimeRange filters by from/to', async () => {
    const { byTimeRange } = await import('../src/lib/filters.js')
    const result = byTimeRange(bundle.networkEvents, 1719500004000, 1719500006000)
    expect(result).toHaveLength(3)
  })

  test('withLimit caps result count', async () => {
    const { withLimit } = await import('../src/lib/filters.js')
    const result = withLimit(bundle.networkEvents, 2)
    expect(result).toHaveLength(2)
  })

  test('withLimit with no limit returns all', async () => {
    const { withLimit } = await import('../src/lib/filters.js')
    const result = withLimit(bundle.networkEvents)
    expect(result).toHaveLength(5)
  })
})

describe('output formatting', () => {
  test('formatOutput json produces pretty JSON', async () => {
    const { formatOutput } = await import('../src/lib/output.js')
    const result = formatOutput({ a: 1, b: 'hello' }, 'json')
    expect(result).toContain('"a": 1')
    expect(result).toContain('"b": "hello"')
  })

  test('formatOutput toon produces human-readable TOON', async () => {
    const { formatOutput } = await import('../src/lib/output.js')
    const result = formatOutput({ a: 1, b: 'hello' }, 'toon')
    expect(result).toContain('a: 1')
    expect(result).toContain('b: hello')
  })

  test('formatOutput table produces table output', async () => {
    const { formatOutput } = await import('../src/lib/output.js')
    const result = formatOutput([{ a: 1, b: 'hello' }], 'table')
    expect(result).toContain('a')
    expect(result).toContain('b')
  })

  test('toon output roundtrips through decode', async () => {
    const { formatOutput } = await import('../src/lib/output.js')
    const { decode } = await import('@toon-format/toon')
    const data = { session: { id: 'abc', name: 'Test', count: 5 } }
    const toonStr = formatOutput(data, 'toon')
    const decoded = decode(toonStr)
    expect(decoded).toEqual(data)
  })
})
