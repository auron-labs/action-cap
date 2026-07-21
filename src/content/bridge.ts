import type { ActionType, ElementSnapshot, UserActionEvent } from '../common/types'

const BRIDGE_REQUEST_SOURCE = 'actioncap-bridge-request'
const BRIDGE_RESPONSE_SOURCE = 'actioncap-bridge-response'

const ALLOWED_ACTION_TYPES: ReadonlySet<string> = new Set([
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

export interface BridgeState {
  recording: boolean
  sessionId: string | null
}

export interface BridgeActionInput {
  type: ActionType
  url?: string
  title?: string
  selector?: string
  element?: ElementSnapshot
  coordinates?: { x: number; y: number }
  scroll?: { x: number; y: number }
  value?: string
  masked?: boolean
  metadata?: Record<string, string | number | boolean | undefined>
}

export type BridgeRequest =
  | { source: typeof BRIDGE_REQUEST_SOURCE; id: string; type: 'ping' }
  | { source: typeof BRIDGE_REQUEST_SOURCE; id: string; type: 'ingest-action'; event: BridgeActionInput }
  | { source: typeof BRIDGE_REQUEST_SOURCE; id: string; type: 'ingest-replay'; payload: unknown }

export interface BridgeResponsePayload {
  source: typeof BRIDGE_RESPONSE_SOURCE
  id: string
  ok: boolean
  recording?: boolean
  sessionId?: string
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!isRecord(value)) return false
  if (value.source !== BRIDGE_REQUEST_SOURCE) return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false

  switch (value.type) {
    case 'ping':
      return true
    case 'ingest-action':
      return isRecord(value.event) && typeof value.event.type === 'string'
    case 'ingest-replay':
      return value.payload !== undefined
    default:
      return false
  }
}

function postResponse(payload: BridgeResponsePayload) {
  window.postMessage(payload, location.origin)
}

function sendMessage(message: unknown) {
  return chrome.runtime.sendMessage(message).catch((error) => {
    console.debug('ActionCap bridge message failed', error)
  })
}

function buildActionEvent(
  input: BridgeActionInput,
  sessionId: string,
): UserActionEvent {
  return {
    id: crypto.randomUUID(),
    sessionId,
    tabId: -1,
    frameId: 0,
    ts: Date.now(),
    type: input.type,
    url: input.url ?? location.href,
    title: input.title ?? document.title,
    selector: input.selector,
    element: input.element,
    coordinates: input.coordinates,
    scroll: input.scroll,
    value: input.value,
    masked: input.masked,
    metadata: input.metadata,
  }
}

export function installBridge(getState: () => BridgeState): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return
    if (!isBridgeRequest(event.data)) return

    const request = event.data
    const state = getState()

    void (async () => {
      if (request.type === 'ping') {
        postResponse({
          source: BRIDGE_RESPONSE_SOURCE,
          id: request.id,
          ok: true,
          recording: state.recording,
          sessionId: state.sessionId ?? undefined,
        })
        return
      }

      if (!state.recording || !state.sessionId) {
        postResponse({
          source: BRIDGE_RESPONSE_SOURCE,
          id: request.id,
          ok: false,
          recording: false,
          error: 'Not recording',
        })
        return
      }

      if (request.type === 'ingest-action') {
        if (!ALLOWED_ACTION_TYPES.has(request.event.type)) {
          postResponse({
            source: BRIDGE_RESPONSE_SOURCE,
            id: request.id,
            ok: false,
            recording: true,
            sessionId: state.sessionId,
            error: `Unsupported action type: ${request.event.type}`,
          })
          return
        }

        const actionEvent = buildActionEvent(request.event, state.sessionId)
        await sendMessage({ type: 'RECORDED_USER_ACTION', event: actionEvent })
        postResponse({
          source: BRIDGE_RESPONSE_SOURCE,
          id: request.id,
          ok: true,
          recording: true,
          sessionId: state.sessionId,
        })
        return
      }

      // ingest-replay
      const replayEvent = {
        id: crypto.randomUUID(),
        sessionId: state.sessionId,
        tabId: -1,
        ts: Date.now(),
        payload: request.payload,
      }

      await sendMessage({ type: 'RECORDED_RRWEB_EVENT', event: replayEvent })
      postResponse({
        source: BRIDGE_RESPONSE_SOURCE,
        id: request.id,
        ok: true,
        recording: true,
        sessionId: state.sessionId,
      })
    })()
  }

  window.addEventListener('message', onMessage)

  return () => {
    window.removeEventListener('message', onMessage)
  }
}
