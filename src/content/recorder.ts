import { record } from 'rrweb'
import { buildStableSelector, summarizeElementText } from '../common/selectors'
import { isSensitiveInputTarget, maskPrintableKeyIfSensitive, maskValueIfSensitive } from '../common/sanitizer'
import type { ReplayEventRecord, RuntimeResponse, UserActionEvent } from '../common/types'

let stopRecordingFn: (() => void) | null = null
let sessionId: string | null = null
let hrefWatcher: number | null = null
let lastUrl = location.href

function makeActionEvent(
  type: UserActionEvent['type'],
  init: Partial<UserActionEvent> = {},
): UserActionEvent | null {
  if (!sessionId) {
    return null
  }

  return {
    id: crypto.randomUUID(),
    sessionId,
    tabId: -1,
    frameId: 0,
    ts: Date.now(),
    type,
    url: location.href,
    title: document.title,
    ...init,
  }
}

function sendMessage(message: unknown) {
  return chrome.runtime.sendMessage(message).catch((error) => {
    console.debug('ActionCap message failed', error)
  })
}

function sendUserAction(event: UserActionEvent | null) {
  if (!event) {
    return
  }

  void sendMessage({ type: 'RECORDED_USER_ACTION', event })
}

function sendReplayEvent(payload: ReplayEventRecord['payload']) {
  if (!sessionId) {
    return
  }

  const event: ReplayEventRecord = {
    id: crypto.randomUUID(),
    sessionId,
    tabId: -1,
    ts: Date.now(),
    payload,
  }

  void sendMessage({ type: 'RECORDED_RRWEB_EVENT', event })
}

function extractElementSnapshot(target: EventTarget | null) {
  const element = target instanceof Element ? target : null
  if (!element) {
    return {}
  }

  const htmlElement = element as HTMLElement

  return {
    selector: buildStableSelector(element),
    element: {
      tagName: element.tagName.toLowerCase(),
      text: maskValueIfSensitive(htmlElement, summarizeElementText(element)),
      id: htmlElement.id || undefined,
      className: typeof htmlElement.className === 'string' ? htmlElement.className : undefined,
      role: htmlElement.getAttribute('role') || undefined,
      name: htmlElement.getAttribute('name') || undefined,
    },
  }
}

function maskIfNeeded(target: HTMLElement | null, value: string) {
  return {
    value: maskValueIfSensitive(target, value) ?? value,
    masked: isSensitiveInputTarget(target),
  }
}

function startHrefWatcher() {
  if (hrefWatcher != null) {
    clearInterval(hrefWatcher)
  }

  hrefWatcher = window.setInterval(() => {
    if (location.href === lastUrl) {
      return
    }

    lastUrl = location.href
    sendUserAction(
      makeActionEvent('navigation', {
        metadata: {
          href: location.href,
        },
      }),
    )
  }, 500)
}

function stopHrefWatcher() {
  if (hrefWatcher != null) {
    clearInterval(hrefWatcher)
    hrefWatcher = null
  }
}

export function installNavigationListeners(onNavigation: () => void) {
  const onLocationChange = () => {
    if (location.href === lastUrl) {
      return
    }

    lastUrl = location.href
    onNavigation()
  }

  window.addEventListener('popstate', onLocationChange)
  window.addEventListener('hashchange', onLocationChange)

  return () => {
    window.removeEventListener('popstate', onLocationChange)
    window.removeEventListener('hashchange', onLocationChange)
  }
}

function installSemanticListeners() {
  const onPointerEvent = (event: MouseEvent) => {
    sendUserAction(
      makeActionEvent(event.type as UserActionEvent['type'], {
        ...extractElementSnapshot(event.target),
        coordinates: { x: event.clientX, y: event.clientY },
      }),
    )
  }

  const onInputEvent = (event: Event) => {
    const target = event.target instanceof HTMLElement ? event.target : null
    const rawValue =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
        ? target.value
        : ''

    const masked = maskIfNeeded(target, rawValue)
    sendUserAction(
      makeActionEvent(event.type as UserActionEvent['type'], {
        ...extractElementSnapshot(event.target),
        value: masked.value,
        masked: masked.masked,
      }),
    )
  }

  let lastScrollTs = 0
  const onScroll = () => {
    const now = Date.now()
    if (now - lastScrollTs < 200) {
      return
    }

    lastScrollTs = now
    sendUserAction(
      makeActionEvent('scroll', {
        scroll: { x: window.scrollX, y: window.scrollY },
      }),
    )
  }

  const onKey = (event: KeyboardEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null
    const maskedKey = maskPrintableKeyIfSensitive(event.key, isSensitiveInputTarget(target))
    sendUserAction(
      makeActionEvent(event.type as UserActionEvent['type'], {
        ...extractElementSnapshot(event.target),
        // Keep printable keys for non-sensitive fields so normal typing still records,
        // while preserving non-printing keys on sensitive fields for navigation fidelity.
        metadata: { key: maskedKey.key },
        masked: maskedKey.masked,
      }),
    )
  }

  const onFocus = (event: FocusEvent) => {
    sendUserAction(
      makeActionEvent(event.type as UserActionEvent['type'], {
        ...extractElementSnapshot(event.target),
      }),
    )
  }

  const cleanupNavigation = installNavigationListeners(() => {
    sendUserAction(makeActionEvent('navigation'))
  })

  document.addEventListener('click', onPointerEvent, true)
  document.addEventListener('dblclick', onPointerEvent, true)
  document.addEventListener('contextmenu', onPointerEvent, true)
  document.addEventListener('input', onInputEvent, true)
  document.addEventListener('change', onInputEvent, true)
  document.addEventListener('submit', onInputEvent, true)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('keyup', onKey, true)
  document.addEventListener('focus', onFocus, true)
  document.addEventListener('blur', onFocus, true)
  window.addEventListener('scroll', onScroll, true)

  return () => {
    document.removeEventListener('click', onPointerEvent, true)
    document.removeEventListener('dblclick', onPointerEvent, true)
    document.removeEventListener('contextmenu', onPointerEvent, true)
    document.removeEventListener('input', onInputEvent, true)
    document.removeEventListener('change', onInputEvent, true)
    document.removeEventListener('submit', onInputEvent, true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('keyup', onKey, true)
    document.removeEventListener('focus', onFocus, true)
    document.removeEventListener('blur', onFocus, true)
    window.removeEventListener('scroll', onScroll, true)
    cleanupNavigation()
  }
}

function startRecorder(nextSessionId: string) {
  if (stopRecordingFn) {
    return
  }

  sessionId = nextSessionId
  lastUrl = location.href
  const cleanupSemantic = installSemanticListeners()

  const stopRrweb = record({
    emit(event) {
      sendReplayEvent(event)
    },
    recordCrossOriginIframes: false,
    maskInputOptions: {
      password: true,
      color: false,
      date: false,
      'datetime-local': false,
      email: false,
      month: false,
      number: false,
      range: false,
      search: false,
      select: false,
      tel: true,
      text: false,
      time: false,
      url: false,
      week: false,
      textarea: false,
    },
  })

  startHrefWatcher()
  sendUserAction(makeActionEvent('navigation'))

  stopRecordingFn = () => {
    cleanupSemantic()
    stopHrefWatcher()
    stopRrweb?.()
    stopRecordingFn = null
    sessionId = null
  }
}

function stopRecorder() {
  stopRecordingFn?.()
}

chrome.runtime.onMessage.addListener((message: { type: string; sessionId?: string }) => {
  if (message.type === 'START_RECORDING' && message.sessionId) {
    startRecorder(message.sessionId)
  }

  if (message.type === 'STOP_RECORDING') {
    stopRecorder()
  }
})

void chrome.runtime
  .sendMessage({
    type: 'CONTENT_BOOTSTRAP_REQUEST',
    url: location.href,
    title: document.title,
  })
  .then((response: RuntimeResponse) => {
    if (response.ok && response.shouldRecord && response.sessionId) {
      startRecorder(response.sessionId)
    }
  })
  .catch(() => {
    // Ignore early init races.
  })
