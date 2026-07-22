import Dexie from 'dexie'
import { t } from './i18n'
import type {
  NetworkEvent,
  ReplayEventRecord,
  SessionBundle,
  SessionRecord,
  TrackedTabRecord,
  UserActionEvent,
} from './types'

class ActionCapDB extends Dexie {
  sessions!: Dexie.Table<SessionRecord, string>
  tabs!: Dexie.Table<TrackedTabRecord, string>
  userActions!: Dexie.Table<UserActionEvent, string>
  networkEvents!: Dexie.Table<NetworkEvent, string>
  replayEvents!: Dexie.Table<ReplayEventRecord, string>

  constructor() {
    super('actioncap-db')

    this.version(1).stores({
      sessions: 'id, status, startTime, endTime, scope',
      tabs: 'id, sessionId, tabId, windowId, [sessionId+tabId], firstSeenAt',
      userActions: 'id, sessionId, tabId, ts, type, [sessionId+ts], [sessionId+tabId]',
      networkEvents: 'id, sessionId, tabId, ts, phase, requestId, [sessionId+ts], [sessionId+tabId]',
      replayEvents: 'id, sessionId, tabId, ts, [sessionId+ts], [sessionId+tabId]',
    })

    this.version(2).stores({
      sessions: 'id, name, status, startTime, endTime, scope',
      tabs: 'id, sessionId, tabId, windowId, [sessionId+tabId], firstSeenAt',
      userActions: 'id, sessionId, tabId, ts, type, [sessionId+ts], [sessionId+tabId]',
      networkEvents: 'id, sessionId, tabId, ts, phase, requestId, [sessionId+ts], [sessionId+tabId]',
      replayEvents: 'id, sessionId, tabId, ts, [sessionId+ts], [sessionId+tabId]',
    })
  }
}

export const db = new ActionCapDB()

type SessionArchive = {
  format: 'actioncap-session-archive'
  version: 1
  exportedAt: number
  bundle: SessionBundle
}

const SESSION_ARCHIVE_FORMAT = 'actioncap-session-archive'
const SESSION_ARCHIVE_VERSION = 1

// Import validation stays local to the extension instead of pulling in Zod from
// the CLI package. The archive checks here are small, bundle-sensitive, and do
// not justify adding a runtime schema dependency to the shipped extension.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getBundleArray<T>(record: Record<string, unknown>, key: string, strict: boolean): T[] {
  const value = record[key]
  if (value === undefined) return []
  if (Array.isArray(value)) return value as T[]
  if (strict) {
    throw new Error(t('import_invalid_format'))
  }
  return []
}

function normalizeSessionBundle(bundle: unknown, strict = false): SessionBundle {
  const record = isRecord(bundle) ? bundle : {}
  return {
    session: isRecord(record.session) ? (record.session as unknown as SessionRecord) : undefined,
    tabs: getBundleArray<TrackedTabRecord>(record, 'tabs', strict),
    userActions: getBundleArray<UserActionEvent>(record, 'userActions', strict),
    networkEvents: getBundleArray<NetworkEvent>(record, 'networkEvents', strict),
    replayEvents: getBundleArray<ReplayEventRecord>(record, 'replayEvents', strict),
  }
}

function asSessionBundle(payload: unknown): SessionBundle {
  if (!isRecord(payload)) {
    throw new Error(t('import_invalid_format'))
  }

  if ('bundle' in payload || 'format' in payload || 'version' in payload) {
    if (
      payload.format !== SESSION_ARCHIVE_FORMAT
      || payload.version !== SESSION_ARCHIVE_VERSION
      || !isRecord(payload.bundle)
    ) {
      throw new Error(t('import_invalid_format'))
    }

    return normalizeSessionBundle(payload.bundle, true)
  }

  // Raw bundle imports are intentionally kept for backward compatibility with
  // older exports that predate the archive wrapper.
  return normalizeSessionBundle(payload)
}

function getImportedSession(bundle: SessionBundle) {
  const session = bundle.session
  if (!session || !isRecord(session)) {
    throw new Error(t('import_missing_session'))
  }
  return session as SessionRecord
}

function failImportValidation(field: string, reason: string): never {
  throw new Error(`Import validation failed: ${field} ${reason}.`)
}

function requireStringField(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) {
    failImportValidation(field, 'must be a non-empty string')
  }
}

function requireNumberField(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failImportValidation(field, 'must be a finite number')
  }
}

function validateImportedBundle(bundle: SessionBundle, session: SessionRecord) {
  requireStringField(session.id, 'session.id')
  requireStringField(session.status, 'session.status')
  requireStringField(session.scope, 'session.scope')
  requireNumberField(session.startTime, 'session.startTime')

  for (const [index, item] of bundle.tabs.entries()) {
    requireNumberField(item.tabId, `tabs[${index}].tabId`)
    requireNumberField(item.windowId, `tabs[${index}].windowId`)
    requireNumberField(item.firstSeenAt, `tabs[${index}].firstSeenAt`)
    requireNumberField(item.lastSeenAt, `tabs[${index}].lastSeenAt`)
  }

  for (const [index, item] of bundle.userActions.entries()) {
    requireNumberField(item.tabId, `userActions[${index}].tabId`)
    requireNumberField(item.ts, `userActions[${index}].ts`)
    requireStringField(item.type, `userActions[${index}].type`)
  }

  for (const [index, item] of bundle.networkEvents.entries()) {
    requireNumberField(item.tabId, `networkEvents[${index}].tabId`)
    requireStringField(item.requestId, `networkEvents[${index}].requestId`)
    requireNumberField(item.ts, `networkEvents[${index}].ts`)
    requireStringField(item.phase, `networkEvents[${index}].phase`)
    requireStringField(item.url, `networkEvents[${index}].url`)
  }

  for (const [index, item] of bundle.replayEvents.entries()) {
    requireNumberField(item.tabId, `replayEvents[${index}].tabId`)
    requireNumberField(item.ts, `replayEvents[${index}].ts`)
    if (item.payload === undefined) {
      failImportValidation(`replayEvents[${index}].payload`, 'is required')
    }
  }
}

function getLatestTimestamp(bundle: SessionBundle, session: SessionRecord) {
  return Math.max(
    session.endTime ?? session.startTime,
    ...bundle.tabs.map((item) => item.lastSeenAt ?? item.firstSeenAt ?? session.startTime),
    ...bundle.userActions.map((item) => item.ts),
    ...bundle.networkEvents.map((item) => item.ts),
    ...bundle.replayEvents.map((item) => item.ts),
  )
}

function buildImportedTabs(bundle: SessionBundle, sessionId: string) {
  const uniqueTabs = new Map<number, TrackedTabRecord>()
  for (const item of bundle.tabs) {
    uniqueTabs.set(item.tabId, {
      ...item,
      id: `${sessionId}:${item.tabId}`,
      sessionId,
    })
  }
  return [...uniqueTabs.values()]
}

export function buildSessionArchive(bundle: SessionBundle): SessionArchive {
  return {
    format: SESSION_ARCHIVE_FORMAT,
    version: SESSION_ARCHIVE_VERSION,
    exportedAt: Date.now(),
    bundle,
  }
}

export async function importSessionArchive(payload: unknown) {
  const bundle = asSessionBundle(payload)
  const session = getImportedSession(bundle)
  validateImportedBundle(bundle, session)
  const importedSessionId = crypto.randomUUID()
  const tabs = buildImportedTabs(bundle, importedSessionId)
  const userActions: UserActionEvent[] = bundle.userActions.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    sessionId: importedSessionId,
  }))
  const networkEvents: NetworkEvent[] = bundle.networkEvents.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    sessionId: importedSessionId,
  }))
  const replayEvents: ReplayEventRecord[] = bundle.replayEvents.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    sessionId: importedSessionId,
  }))
  const latestTimestamp = getLatestTimestamp(bundle, session)
  const firstTab = tabs[0]
  const importedSession: SessionRecord = {
    ...session,
    id: importedSessionId,
    status: 'stopped',
    endTime: latestTimestamp,
    startTabId: firstTab?.tabId ?? session.startTabId,
    startWindowId: firstTab?.windowId ?? session.startWindowId,
    tabCount: tabs.length,
    actionCount: userActions.length,
    networkCount: networkEvents.length,
    replayCount: replayEvents.length,
  }

  await db.transaction('rw', [db.sessions, db.tabs, db.userActions, db.networkEvents, db.replayEvents], async () => {
    await db.sessions.put(importedSession)
    if (tabs.length) await db.tabs.bulkPut(tabs)
    if (userActions.length) await db.userActions.bulkPut(userActions)
    if (networkEvents.length) await db.networkEvents.bulkPut(networkEvents)
    if (replayEvents.length) await db.replayEvents.bulkPut(replayEvents)
  })

  return importedSessionId
}

export async function getSessionBundle(sessionId: string): Promise<SessionBundle> {
  const [session, tabs, userActions, networkEvents, replayEvents] = await Promise.all([
    db.sessions.get(sessionId),
    db.tabs.where('sessionId').equals(sessionId).toArray(),
    db.userActions.where('sessionId').equals(sessionId).sortBy('ts'),
    db.networkEvents.where('sessionId').equals(sessionId).sortBy('ts'),
    db.replayEvents.where('sessionId').equals(sessionId).sortBy('ts'),
  ])

  return { session, tabs, userActions, networkEvents, replayEvents }
}

export async function listSessions() {
  return db.sessions.orderBy('startTime').reverse().toArray()
}

export async function clearAllSessions() {
  await db.transaction('rw', [db.sessions, db.tabs, db.userActions, db.networkEvents, db.replayEvents], async () => {
    await db.sessions.clear()
    await db.tabs.clear()
    await db.userActions.clear()
    await db.networkEvents.clear()
    await db.replayEvents.clear()
  })
}
