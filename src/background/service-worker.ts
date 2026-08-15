import { t } from '../common/i18n'
import { db } from '../common/storage'
import { isProbablyTextMimeType, mergeHeaders, sanitizeBody, sanitizeHeaders, sanitizeUrl } from '../common/sanitizer'
import { ACTIVE_RECORDING_KEY, snapshotFromActiveRecording } from '../common/recording-state'
import { buildSessionName } from '../common/session-utils'
import { IS_FIREFOX } from '../common/browser-target'
import { FirefoxNetworkCapture } from '../common/firefox-network-capture'

import type {
  ActiveRecordingState,
  ExternalActionInput,
  ExternalMessage,
  NetworkEvent,
  RecordingScope,
  RecordingStateSnapshot,
  ReplayEventRecord,
  RuntimeMessage,
  RuntimeResponse,
  SessionRecord,
  TrackedTabRecord,
  UserActionEvent,
} from '../common/types'

const ALLOWED_EXTERNAL_ACTION_TYPES: ReadonlySet<string> = new Set([
  'click',
  'dblclick',
  'contextmenu',
  'input',
  'change',
  'submit',
  'keydown',
  'keyup',
  'scroll',
  'focus',
  'blur',
  'navigation',
])
const NAVIGATION_SCREENSHOT_METADATA_KEY = 'screenshot'
const NAVIGATION_SCREENSHOT_QUALITY = 65

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

let activeRecording: ActiveRecordingState | null = null
const requestContexts = new Map<string, RequestContext>()
const navigationActions = new Map<number, UserActionEvent>()
const pendingScreenshotEvents = new Set<string>()

let firefoxNetworkCapture: FirefoxNetworkCapture | null = null

async function init() {
  const stored = await chrome.storage.local.get(ACTIVE_RECORDING_KEY)
  const restored = stored[ACTIVE_RECORDING_KEY] as ActiveRecordingState | undefined

  if (!restored) {
    return
  }

  activeRecording = {
    ...restored,
    captureScreenshots: restored.captureScreenshots === true,
  }
  activeRecording.status = 'recording'

  if (IS_FIREFOX && activeRecording.trackedTabIds.length > 0) {
    initFirefoxNetworkCapture()
  }

  await Promise.all(activeRecording.trackedTabIds.map((tabId) => maybeAttachDebugger(tabId)))
}

function initFirefoxNetworkCapture() {
  if (!IS_FIREFOX || firefoxNetworkCapture) return

  firefoxNetworkCapture = new FirefoxNetworkCapture(
    recordNetworkEvent,
    (tabId) => isTabTracked(tabId),
    () => activeRecording?.sessionId ?? null,
  )
  firefoxNetworkCapture.start()
}

void init()

function makeStateSnapshot(): RecordingStateSnapshot {
  return snapshotFromActiveRecording(activeRecording)
}

async function persistActiveState() {
  if (!activeRecording) {
    await chrome.storage.local.remove(ACTIVE_RECORDING_KEY)
    return
  }

  await chrome.storage.local.set({ [ACTIVE_RECORDING_KEY]: activeRecording })
}

function getOrCreateRequestContext(key: string, tabId: number) {
  const existing = requestContexts.get(key)
  if (existing) {
    return existing
  }

  const created: RequestContext = {
    startedAt: Date.now(),
    tabId,
    url: '',
  }
  requestContexts.set(key, created)
  return created
}

function isTrackableUrl(url: string | undefined): url is string {
  if (!url) {
    return false
  }

  return url.startsWith('http://') || url.startsWith('https://')
}

function isTabTracked(tabId: number) {
  return Boolean(activeRecording?.trackedTabIds.includes(tabId))
}

async function updateSessionCounts() {
  if (!activeRecording) {
    return
  }

  await db.sessions.update(activeRecording.sessionId, {
    tabCount: activeRecording.stats.tabCount,
    actionCount: activeRecording.stats.actionCount,
    networkCount: activeRecording.stats.networkCount,
    replayCount: activeRecording.stats.replayCount,
  })

  await persistActiveState()
}

async function addTrackedTab(tab: chrome.tabs.Tab) {
  if (!activeRecording || tab.id == null) {
    return
  }

  if (!activeRecording.trackedTabIds.includes(tab.id)) {
    activeRecording.trackedTabIds.push(tab.id)
    activeRecording.stats.tabCount = activeRecording.trackedTabIds.length
  }

  const record: TrackedTabRecord = {
    id: `${activeRecording.sessionId}:${tab.id}`,
    sessionId: activeRecording.sessionId,
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
    faviconUrl: tab.favIconUrl,
    attachedDebugger: activeRecording.debuggerTabIds.includes(tab.id),
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
  }

  await db.tabs.put(record)
  await updateSessionCounts()

  if (IS_FIREFOX) {
    initFirefoxNetworkCapture()
  }

  if (isTrackableUrl(tab.url)) {
    await maybeAttachDebugger(tab.id)
    await sendStartMessage(tab.id)
  }
}

async function updateTrackedTab(tab: chrome.tabs.Tab) {
  if (!activeRecording || tab.id == null || !isTabTracked(tab.id)) {
    return
  }

  await db.tabs.put({
    id: `${activeRecording.sessionId}:${tab.id}`,
    sessionId: activeRecording.sessionId,
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
    faviconUrl: tab.favIconUrl,
    attachedDebugger: activeRecording.debuggerTabIds.includes(tab.id),
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
  })
}

async function recordUserAction(event: UserActionEvent) {
  if (!activeRecording || event.sessionId !== activeRecording.sessionId) {
    return
  }

  await db.userActions.put(event)
  activeRecording.stats.actionCount += 1
  await updateSessionCounts()
}

async function recordReplayEvent(event: ReplayEventRecord) {
  if (!activeRecording || event.sessionId !== activeRecording.sessionId) {
    return
  }

  await db.replayEvents.put(event)
  activeRecording.stats.replayCount += 1
  await updateSessionCounts()
}

async function recordNetworkEvent(event: NetworkEvent) {
  if (!activeRecording || event.sessionId !== activeRecording.sessionId) {
    return
  }

  await db.networkEvents.put({
    ...event,
    url: sanitizeUrl(event.url) ?? event.url,
    requestHeaders: sanitizeHeaders(event.requestHeaders),
    responseHeaders: sanitizeHeaders(event.responseHeaders),
    requestBody: sanitizeBody(event.requestBody, event.requestHeaders?.['content-type'] ?? event.requestHeaders?.['Content-Type']),
    responseBody: sanitizeBody(event.responseBody, event.mimeType ?? event.responseHeaders?.['content-type'] ?? event.responseHeaders?.['Content-Type']),
  })
  activeRecording.stats.networkCount += 1
  await updateSessionCounts()
}

async function maybeAttachDebugger(tabId: number) {
  if (IS_FIREFOX) return
  if (!activeRecording || activeRecording.debuggerTabIds.includes(tabId)) {
    return
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3')
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable')
    activeRecording.debuggerTabIds.push(tabId)
    await updateTrackedDebuggerState(tabId, true)
    await persistActiveState()
  } catch (error) {
    console.warn('Failed to attach debugger', tabId, error)
  }
}

async function detachDebugger(tabId: number) {
  if (IS_FIREFOX) return
  if (!activeRecording || !activeRecording.debuggerTabIds.includes(tabId)) {
    return
  }

  try {
    await chrome.debugger.detach({ tabId })
  } catch (error) {
    console.warn('Failed to detach debugger', tabId, error)
  }

  activeRecording.debuggerTabIds = activeRecording.debuggerTabIds.filter((id) => id !== tabId)
  await updateTrackedDebuggerState(tabId, false)
  await persistActiveState()
}

async function updateTrackedDebuggerState(tabId: number, attached: boolean) {
  if (!activeRecording) {
    return
  }

  const existing = await db.tabs.get(`${activeRecording.sessionId}:${tabId}`)
  if (!existing) {
    return
  }

  await db.tabs.put({ ...existing, attachedDebugger: attached, lastSeenAt: Date.now() })
}

async function sendStartMessage(tabId: number) {
  if (!activeRecording) {
    return
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'START_RECORDING',
      sessionId: activeRecording.sessionId,
    })
  } catch (error) {
    console.debug('Content script start message skipped', tabId, error)
  }
}

async function sendStopMessage(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' })
  } catch (error) {
    console.debug('Content script stop message skipped', tabId, error)
  }
}

async function tabsForScope(scope: RecordingScope, startWindowId: number, startTabId: number) {
  if (scope === 'current-tab') {
    const tab = await chrome.tabs.get(startTabId)
    return tab ? [tab] : []
  }

  if (scope === 'cross-tab') {
    return chrome.tabs.query({ windowId: startWindowId })
  }

  return chrome.tabs.query({})
}

async function startRecording(scope: RecordingScope, captureScreenshots = false) {
  if (activeRecording) {
    return { ok: false, error: t('error_recording_already_active') } satisfies RuntimeResponse
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id) {
    return { ok: false, error: t('error_no_active_tab') } satisfies RuntimeResponse
  }

  const sessionId = crypto.randomUUID()
  const startTime = Date.now()
  const session: SessionRecord = {
    id: sessionId,
    name: buildSessionName(startTime, scope),
    scope,
    status: 'recording',
    startTime,
    startTabId: activeTab.id,
    startWindowId: activeTab.windowId,
    tabCount: 0,
    actionCount: 0,
    networkCount: 0,
    replayCount: 0,
  }

  await db.sessions.put(session)

  activeRecording = {
    sessionId,
    scope,
    captureScreenshots,
    status: 'recording',
    startTime: session.startTime,
    startTabId: session.startTabId,
    startWindowId: session.startWindowId,
    trackedTabIds: [],
    debuggerTabIds: [],
    stats: { tabCount: 0, actionCount: 0, networkCount: 0, replayCount: 0 },
  }

  const tabs = await tabsForScope(scope, activeTab.windowId, activeTab.id)
  for (const tab of tabs) {
    if (tab.id != null) {
      await addTrackedTab(tab)
    }
  }

  await recordSystemAction('tab-activated', activeTab.id, {
    title: activeTab.title,
    url: activeTab.url,
  })

  await persistActiveState()

  return { ok: true, state: makeStateSnapshot() } satisfies RuntimeResponse
}

async function stopRecording(openResults = true) {
  if (!activeRecording) {
    return { ok: false, error: t('error_no_active_recording') } satisfies RuntimeResponse
  }

  activeRecording.status = 'stopping'
  await persistActiveState()

  const finalState = activeRecording
  for (const tabId of finalState.trackedTabIds) {
    await sendStopMessage(tabId)
  }
  for (const tabId of [...finalState.debuggerTabIds]) {
    await detachDebugger(tabId)
  }

  await db.sessions.update(finalState.sessionId, {
    status: 'stopped',
    endTime: Date.now(),
    tabCount: finalState.stats.tabCount,
    actionCount: finalState.stats.actionCount,
    networkCount: finalState.stats.networkCount,
    replayCount: finalState.stats.replayCount,
  })

  const resultUrl = chrome.runtime.getURL(`results.html?sessionId=${finalState.sessionId}`)
  activeRecording = null
  requestContexts.clear()
  navigationActions.clear()
  pendingScreenshotEvents.clear()
  firefoxNetworkCapture?.clear()
  await persistActiveState()

  if (openResults) {
    try {
      await chrome.tabs.create({
        windowId: finalState.startWindowId,
        url: resultUrl,
        active: true,
      })
    } catch {
      await chrome.tabs.create({ url: resultUrl, active: true })
    }
  }

  return { ok: true, state: makeStateSnapshot() } satisfies RuntimeResponse
}

async function recordSystemAction(
  type: UserActionEvent['type'],
  tabId: number,
  info: { title?: string; url?: string; metadata?: UserActionEvent['metadata'] },
) {
  if (!activeRecording) {
    return undefined
  }

  const event: UserActionEvent = {
    id: crypto.randomUUID(),
    sessionId: activeRecording.sessionId,
    tabId,
    frameId: 0,
    ts: Date.now(),
    type,
    url: info.url ?? '',
    title: info.title,
    metadata: info.metadata,
  }

  if (type === 'navigation') {
    if (event.ts >= (navigationActions.get(tabId)?.ts ?? 0)) {
      navigationActions.set(tabId, event)
    }
  }
  await recordUserAction(event)
  return event
}

async function findNavigationAction(sessionId: string, tabId: number, destinationUrl: string) {
  const events = await db.userActions
    .where('[sessionId+tabId]')
    .equals([sessionId, tabId])
    .filter((event) => event.type === 'navigation' && event.url === destinationUrl)
    .sortBy('ts')

  return events.at(-1)
}

async function isActiveDestinationTab(tabId: number, windowId: number, destinationUrl: string) {
  const [[activeTab], activeWindow] = await Promise.all([
    chrome.tabs.query({ active: true, windowId }),
    chrome.windows.get(windowId),
  ])

  return Boolean(
    activeWindow.focused &&
    activeTab?.id === tabId &&
    activeTab.windowId === windowId &&
    activeTab.url === destinationUrl,
  )
}

async function captureNavigationScreenshot(
  tabId: number,
  windowId: number,
  destinationUrl: string,
) {
  const sessionId = activeRecording?.captureScreenshots ? activeRecording.sessionId : undefined
  if (!sessionId || !isTrackableUrl(destinationUrl)) {
    return
  }

  const navigationEvent = navigationActions.get(tabId)
  const candidate =
    navigationEvent?.sessionId === sessionId &&
    navigationEvent.url === destinationUrl
      ? navigationEvent
      : undefined
  const storedEvent = await findNavigationAction(sessionId, tabId, destinationUrl)
  const event = !storedEvent || (candidate && candidate.ts >= storedEvent.ts) ? candidate ?? storedEvent : storedEvent
  if (!event) {
    return
  }

  const eventKey = `${sessionId}:${event.id}`
  if (pendingScreenshotEvents.has(eventKey)) {
    return
  }

  pendingScreenshotEvents.add(eventKey)
  try {
    const storedEvent = await db.userActions.get(event.id)
    if (!storedEvent || typeof storedEvent.metadata?.[NAVIGATION_SCREENSHOT_METADATA_KEY] === 'string') {
      return
    }

    if (!await isActiveDestinationTab(tabId, windowId, destinationUrl)) {
      return
    }

    const screenshot = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: NAVIGATION_SCREENSHOT_QUALITY,
    })

    if (
      !activeRecording ||
      activeRecording.sessionId !== sessionId ||
      !activeRecording.captureScreenshots
    ) {
      return
    }

    if (!await isActiveDestinationTab(tabId, windowId, destinationUrl)) {
      return
    }

    const latestEvent = await db.userActions.get(event.id)
    if (!latestEvent || typeof latestEvent.metadata?.[NAVIGATION_SCREENSHOT_METADATA_KEY] === 'string') {
      return
    }

    await db.userActions.put({
      ...latestEvent,
      metadata: {
        ...latestEvent.metadata,
        [NAVIGATION_SCREENSHOT_METADATA_KEY]: screenshot,
      },
    })
  } catch (error) {
    console.debug('Failed to capture navigation screenshot', tabId, error)
  } finally {
    pendingScreenshotEvents.delete(eventKey)
  }
}

function buildExternalActionEvent(
  input: ExternalActionInput,
  tabId: number,
  frameId: number,
  senderTab?: chrome.tabs.Tab,
): UserActionEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: activeRecording!.sessionId,
    tabId,
    frameId,
    ts: Date.now(),
    type: input.type,
    url: input.url ?? senderTab?.url ?? '',
    title: input.title ?? senderTab?.title,
    selector: input.selector,
    element: input.element,
    coordinates: input.coordinates,
    scroll: input.scroll,
    value: input.value,
    masked: input.masked,
    metadata: input.metadata,
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void (async () => {
    const senderTabId = sender.tab?.id
    const senderFrameId = sender.frameId ?? 0

    switch (message.type) {
      case 'GET_RECORDING_STATE': {
        sendResponse({ ok: true, state: makeStateSnapshot() } satisfies RuntimeResponse)
        return
      }
      case 'START_RECORDING': {
        sendResponse(await startRecording(message.scope, message.captureScreenshots === true))
        return
      }
      case 'STOP_RECORDING': {
        sendResponse(await stopRecording())
        return
      }
      case 'CONTENT_BOOTSTRAP_REQUEST': {
        const tabId = sender.tab?.id
        if (!activeRecording || tabId == null || !isTabTracked(tabId)) {
          sendResponse({ ok: true, shouldRecord: false } satisfies RuntimeResponse)
          return
        }

        sendResponse({
          ok: true,
          shouldRecord: true,
          sessionId: activeRecording.sessionId,
        } satisfies RuntimeResponse)
        return
      }
      case 'RECORDED_USER_ACTION': {
        if (senderTabId == null) {
          sendResponse({ ok: false, error: 'Missing sender tab id.' } satisfies RuntimeResponse)
          return
        }

        await recordUserAction({
          ...message.event,
          tabId: senderTabId,
          frameId: senderFrameId,
        })
        sendResponse({ ok: true } satisfies RuntimeResponse)
        return
      }
      case 'RECORDED_RRWEB_EVENT': {
        if (senderTabId == null) {
          sendResponse({ ok: false, error: 'Missing sender tab id.' } satisfies RuntimeResponse)
          return
        }

        await recordReplayEvent({
          ...message.event,
          tabId: senderTabId,
        })
        sendResponse({ ok: true } satisfies RuntimeResponse)
        return
      }
      default:
        sendResponse({ ok: false, error: 'Unsupported message.' } satisfies RuntimeResponse)
    }
  })()

  return true
})

chrome.runtime.onMessageExternal.addListener((message: ExternalMessage, sender, sendResponse) => {
  void (async () => {
    const senderTabId = sender.tab?.id
    const senderFrameId = sender.frameId ?? 0

    switch (message.type) {
      case 'GET_RECORDING_STATE': {
        sendResponse({ ok: true, state: makeStateSnapshot() } satisfies RuntimeResponse)
        return
      }
      case 'START_RECORDING': {
        if (activeRecording) {
          if (!message.restart) {
            sendResponse({ ok: false, error: t('error_recording_already_active') } satisfies RuntimeResponse)
            return
          }

          // Restart: stop the current recording without opening the results
          // page, then start a fresh session with the requested scope.
          await stopRecording(false)
        }

        sendResponse(await startRecording(message.scope, message.captureScreenshots === true))
        return
      }
      case 'STOP_RECORDING': {
        sendResponse(await stopRecording(message.openResults ?? true))
        return
      }
      case 'INGEST_ACTION': {
        if (!activeRecording) {
          sendResponse({ ok: false, error: 'Not recording' } satisfies RuntimeResponse)
          return
        }

        if (!ALLOWED_EXTERNAL_ACTION_TYPES.has(message.event.type)) {
          sendResponse({ ok: false, error: `Unsupported action type: ${message.event.type}` } satisfies RuntimeResponse)
          return
        }

        if (senderTabId == null) {
          sendResponse({ ok: false, error: 'Missing sender tab id.' } satisfies RuntimeResponse)
          return
        }

        await recordUserAction(buildExternalActionEvent(message.event, senderTabId, senderFrameId, sender.tab))
        sendResponse({ ok: true, sessionId: activeRecording.sessionId } satisfies RuntimeResponse)
        return
      }
      case 'INGEST_REPLAY': {
        if (!activeRecording) {
          sendResponse({ ok: false, error: 'Not recording' } satisfies RuntimeResponse)
          return
        }

        if (senderTabId == null) {
          sendResponse({ ok: false, error: 'Missing sender tab id.' } satisfies RuntimeResponse)
          return
        }

        await recordReplayEvent({
          id: crypto.randomUUID(),
          sessionId: activeRecording.sessionId,
          tabId: senderTabId,
          ts: Date.now(),
          payload: message.payload,
        })
        sendResponse({ ok: true, sessionId: activeRecording.sessionId } satisfies RuntimeResponse)
        return
      }
      default:
        sendResponse({ ok: false, error: 'Unsupported external message.' } satisfies RuntimeResponse)
    }
  })()

  return true
})

chrome.tabs.onActivated.addListener((activeInfo) => {
  void (async () => {
    if (!activeRecording) {
      return
    }

    const tab = await chrome.tabs.get(activeInfo.tabId)
    if (!tab.id) {
      return
    }

    if (activeRecording.scope !== 'current-tab') {
      const canTrack =
        activeRecording.scope === 'all-windows' ||
        (activeRecording.scope === 'cross-tab' && tab.windowId === activeRecording.startWindowId)

      if (canTrack) {
        await addTrackedTab(tab)
      }
    }

    if (isTabTracked(tab.id)) {
      await recordSystemAction('tab-activated', tab.id, { title: tab.title, url: tab.url })
    }
  })()
})

chrome.tabs.onCreated.addListener((tab) => {
  void (async () => {
    if (!activeRecording || tab.id == null) {
      return
    }

    const inScope =
      activeRecording.scope === 'all-windows' ||
      (activeRecording.scope === 'cross-tab' && tab.windowId === activeRecording.startWindowId)

    if (!inScope) {
      return
    }

    await addTrackedTab(tab)
    await recordSystemAction('tab-created', tab.id, { title: tab.title, url: tab.url })
  })()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    if (!activeRecording || !isTabTracked(tabId)) {
      return
    }

    await recordSystemAction('tab-removed', tabId, {
      metadata: { removed: true },
      url: '',
    })
    await detachDebugger(tabId)
  })()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void (async () => {
    if (!activeRecording || !isTabTracked(tabId)) {
      return
    }

    await updateTrackedTab(tab)

    if (changeInfo.url && navigationActions.get(tabId)?.url !== changeInfo.url) {
      await recordSystemAction('navigation', tabId, { title: tab.title, url: changeInfo.url })
    }

    const destinationUrl = tab.url
    if (changeInfo.status === 'complete' && isTrackableUrl(destinationUrl)) {
      await maybeAttachDebugger(tabId)
      await sendStartMessage(tabId)
      await captureNavigationScreenshot(tabId, tab.windowId, destinationUrl)
    }
  })()
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  void (async () => {
    if (!activeRecording || windowId === chrome.windows.WINDOW_ID_NONE) {
      return
    }

    const tabs = await chrome.tabs.query({ active: true, windowId })
    const activeTab = tabs[0]
    if (!activeTab?.id) {
      return
    }

    if (activeRecording.scope === 'all-windows' || activeTab.windowId === activeRecording.startWindowId) {
      await recordSystemAction('window-focus', activeTab.id, {
        title: activeTab.title,
        url: activeTab.url,
        metadata: { windowId },
      })
    }
  })()
})

chrome.webNavigation.onCommitted.addListener((details) => {
  void (async () => {
    if (!activeRecording || details.frameId !== 0 || !isTabTracked(details.tabId)) {
      return
    }

    const tab = await chrome.tabs.get(details.tabId)
    await recordSystemAction('navigation', details.tabId, {
      title: tab?.title,
      url: details.url,
      metadata: { transitionType: details.transitionType },
    })
  })()
})

if (!IS_FIREFOX) {
chrome.debugger.onEvent.addListener((source, method, params) => {
  void (async () => {
    const tabId = source.tabId
    if (!activeRecording || tabId == null || !isTabTracked(tabId)) {
      return
    }

    const payload = (params ?? {}) as Record<string, any>
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : undefined
    if (!requestId) {
      return
    }

    const key = `${tabId}:${requestId}`

    if (method === 'Network.requestWillBeSent') {
      const request = payload.request as { headers?: Record<string, unknown>; postData?: string; url: string; method?: string } | undefined
      if (!request?.url) {
        return
      }

      const requestHeaders = sanitizeHeaders(request.headers)
      const context = getOrCreateRequestContext(key, tabId)
      context.startedAt = Date.now()
      context.tabId = tabId
      context.url = sanitizeUrl(request.url) ?? request.url
      context.method = request.method
      context.requestHeaders = mergeHeaders(context.requestHeaders, requestHeaders)
      context.requestBody = sanitizeBody(request.postData, requestHeaders?.['content-type'] ?? requestHeaders?.['Content-Type'])
      context.resourceType = typeof payload.type === 'string' ? payload.type : context.resourceType
      context.initiator = typeof payload.initiator?.type === 'string' ? payload.initiator.type : context.initiator

      await recordNetworkEvent({
        id: crypto.randomUUID(),
        sessionId: activeRecording.sessionId,
        tabId,
        requestId,
        ts: Date.now(),
        phase: 'request',
        url: context.url,
        method: request.method,
        resourceType: typeof payload.type === 'string' ? payload.type : undefined,
        requestHeaders: context.requestHeaders,
        requestBody: context.requestBody,
        initiator: typeof payload.initiator?.type === 'string' ? payload.initiator.type : undefined,
        truncated: false,
      })
      return
    }

    if (method === 'Network.requestWillBeSentExtraInfo') {
      const context = getOrCreateRequestContext(key, tabId)
      const requestHeaders = sanitizeHeaders(payload.headers as Record<string, unknown> | undefined)
      context.requestHeaders = mergeHeaders(context.requestHeaders, requestHeaders)
      return
    }

    if (method === 'Network.responseReceived') {
      const existing = getOrCreateRequestContext(key, tabId)

      const response = payload.response as
        | { status?: number; statusText?: string; headers?: Record<string, unknown>; mimeType?: string }
        | undefined

      existing.status = response?.status
      existing.statusText = response?.statusText
      existing.responseHeaders = mergeHeaders(existing.responseHeaders, sanitizeHeaders(response?.headers))
      existing.mimeType = response?.mimeType
      existing.resourceType = typeof payload.type === 'string' ? payload.type : existing.resourceType
      return
    }

    if (method === 'Network.responseReceivedExtraInfo') {
      const existing = getOrCreateRequestContext(key, tabId)
      existing.responseHeaders = mergeHeaders(
        existing.responseHeaders,
        sanitizeHeaders(payload.headers as Record<string, unknown> | undefined),
      )
      if (typeof payload.statusCode === 'number' && existing.status == null) {
        existing.status = payload.statusCode
      }
      return
    }

    if (method === 'Network.loadingFinished') {
      const existing = requestContexts.get(key)
      if (!existing) {
        return
      }

      let responseBody: string | undefined
      let bodyEncoding: 'plain' | 'base64' = 'plain'
      let truncated = false

      if (isProbablyTextMimeType(existing.mimeType)) {
        try {
          const response = (await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', {
            requestId,
          })) as {
            body?: string
            base64Encoded?: boolean
          }
          responseBody = sanitizeBody(response.body, existing.mimeType)
          truncated = false
          bodyEncoding = response.base64Encoded ? 'base64' : 'plain'
        } catch (error) {
          responseBody = `[failed to capture response body: ${String(error)}]`
        }
      } else {
        responseBody = `[binary ${existing.mimeType ?? 'unknown'} omitted]`
        truncated = true
      }

      await recordNetworkEvent({
        id: crypto.randomUUID(),
        sessionId: activeRecording.sessionId,
        tabId,
        requestId,
        ts: Date.now(),
        phase: 'response',
        url: existing.url,
        method: existing.method,
        status: existing.status,
        statusText: existing.statusText,
        resourceType: existing.resourceType,
        mimeType: existing.mimeType,
        requestHeaders: existing.requestHeaders,
        responseHeaders: existing.responseHeaders,
        requestBody: existing.requestBody,
        responseBody,
        bodyEncoding,
        durationMs: Date.now() - existing.startedAt,
        initiator: existing.initiator,
        truncated,
      })

      requestContexts.delete(key)
      return
    }

    if (method === 'Network.loadingFailed') {
      const existing = requestContexts.get(key)
      if (!existing) {
        return
      }

      await recordNetworkEvent({
        id: crypto.randomUUID(),
        sessionId: activeRecording.sessionId,
        tabId,
        requestId,
        ts: Date.now(),
        phase: 'response',
        url: existing.url,
        method: existing.method,
        resourceType: existing.resourceType,
        requestHeaders: existing.requestHeaders,
        requestBody: existing.requestBody,
        errorText: typeof payload.errorText === 'string' ? payload.errorText : undefined,
        durationMs: Date.now() - existing.startedAt,
      })

      requestContexts.delete(key)
    }
  })()
})

chrome.debugger.onDetach.addListener((source, reason) => {
  void (async () => {
    if (!activeRecording || source.tabId == null) {
      return
    }

    activeRecording.debuggerTabIds = activeRecording.debuggerTabIds.filter((tabId) => tabId !== source.tabId)
    await updateTrackedDebuggerState(source.tabId, false)
    await persistActiveState()

    // If the user cancels Chrome's debugging banner, the debugger session is terminated
    // externally and network capture becomes incomplete. End the recording immediately.
    if (activeRecording.status !== 'stopping' && reason === 'canceled_by_user') {
      await stopRecording()
    }
  })()
})
}
