import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSessionArchive, db, importSessionArchive } from './storage.ts'
import type { NetworkEvent, ReplayEventRecord, SessionBundle, SessionRecord, TrackedTabRecord, UserActionEvent } from './types.ts'

function buildValidBundle(): SessionBundle {
  const session: SessionRecord = {
    id: 'session-original',
    name: 'Imported session',
    scope: 'current-tab',
    status: 'recording',
    startTime: 100,
    endTime: 150,
    startTabId: 1,
    startWindowId: 2,
    tabCount: 1,
    actionCount: 1,
    networkCount: 1,
    replayCount: 1,
  }

  const tabs: TrackedTabRecord[] = [{
    id: 'tab-original',
    sessionId: session.id,
    tabId: 11,
    windowId: 22,
    title: 'Example',
    url: 'https://example.com',
    faviconUrl: 'https://example.com/favicon.ico',
    attachedDebugger: true,
    firstSeenAt: 110,
    lastSeenAt: 210,
  }]

  const userActions: UserActionEvent[] = [{
    id: 'action-original',
    sessionId: session.id,
    tabId: 11,
    frameId: 0,
    ts: 220,
    type: 'click',
    url: 'https://example.com',
    title: 'Example',
  }]

  const networkEvents: NetworkEvent[] = [{
    id: 'network-original',
    sessionId: session.id,
    tabId: 11,
    requestId: 'request-1',
    ts: 330,
    phase: 'request',
    url: 'https://example.com/api',
    method: 'GET',
  }]

  const replayEvents: ReplayEventRecord[] = [{
    id: 'replay-original',
    sessionId: session.id,
    tabId: 11,
    ts: 440,
    payload: { type: 'snapshot' },
  }]

  return { session, tabs, userActions, networkEvents, replayEvents }
}

function installDbSpies() {
  const writes = {
    sessions: [] as SessionRecord[],
    tabs: [] as TrackedTabRecord[],
    userActions: [] as UserActionEvent[],
    networkEvents: [] as NetworkEvent[],
    replayEvents: [] as ReplayEventRecord[],
  }
  let transactionCalls = 0

  const originals = {
    transaction: db.transaction,
    sessionsPut: db.sessions.put,
    tabsBulkPut: db.tabs.bulkPut,
    userActionsBulkPut: db.userActions.bulkPut,
    networkEventsBulkPut: db.networkEvents.bulkPut,
    replayEventsBulkPut: db.replayEvents.bulkPut,
  }

  Object.defineProperty(db, 'transaction', {
    configurable: true,
    writable: true,
    value: async (_mode: unknown, _tables: unknown, scope: () => Promise<void>) => {
      transactionCalls += 1
      await scope()
    },
  })

  Object.defineProperty(db.sessions, 'put', {
    configurable: true,
    writable: true,
    value: async (value: SessionRecord) => {
      writes.sessions.push(value)
      return value.id
    },
  })

  Object.defineProperty(db.tabs, 'bulkPut', {
    configurable: true,
    writable: true,
    value: async (values: TrackedTabRecord[]) => {
      writes.tabs.push(...values)
    },
  })

  Object.defineProperty(db.userActions, 'bulkPut', {
    configurable: true,
    writable: true,
    value: async (values: UserActionEvent[]) => {
      writes.userActions.push(...values)
    },
  })

  Object.defineProperty(db.networkEvents, 'bulkPut', {
    configurable: true,
    writable: true,
    value: async (values: NetworkEvent[]) => {
      writes.networkEvents.push(...values)
    },
  })

  Object.defineProperty(db.replayEvents, 'bulkPut', {
    configurable: true,
    writable: true,
    value: async (values: ReplayEventRecord[]) => {
      writes.replayEvents.push(...values)
    },
  })

  return {
    writes,
    get transactionCalls() {
      return transactionCalls
    },
    restore() {
      Object.defineProperty(db, 'transaction', { configurable: true, writable: true, value: originals.transaction })
      Object.defineProperty(db.sessions, 'put', { configurable: true, writable: true, value: originals.sessionsPut })
      Object.defineProperty(db.tabs, 'bulkPut', { configurable: true, writable: true, value: originals.tabsBulkPut })
      Object.defineProperty(db.userActions, 'bulkPut', { configurable: true, writable: true, value: originals.userActionsBulkPut })
      Object.defineProperty(db.networkEvents, 'bulkPut', { configurable: true, writable: true, value: originals.networkEventsBulkPut })
      Object.defineProperty(db.replayEvents, 'bulkPut', { configurable: true, writable: true, value: originals.replayEventsBulkPut })
    },
  }
}

test('importSessionArchive imports a valid wrapped archive and rewrites persisted ids', async () => {
  const spies = installDbSpies()

  try {
    const bundle = buildValidBundle()
    const importedSessionId = await importSessionArchive(buildSessionArchive(bundle))

    assert.equal(spies.transactionCalls, 1)
    assert.equal(spies.writes.sessions.length, 1)
    assert.equal(typeof importedSessionId, 'string')
    assert.notEqual(importedSessionId, bundle.session?.id)

    const [session] = spies.writes.sessions
    assert.equal(session.id, importedSessionId)
    assert.equal(session.status, 'stopped')
    assert.equal(session.endTime, 440)
    assert.equal(session.startTabId, 11)
    assert.equal(session.startWindowId, 22)
    assert.equal(session.tabCount, 1)
    assert.equal(session.actionCount, 1)
    assert.equal(session.networkCount, 1)
    assert.equal(session.replayCount, 1)

    assert.deepEqual(spies.writes.tabs.map((item) => ({ id: item.id, sessionId: item.sessionId, tabId: item.tabId })), [{
      id: `${importedSessionId}:11`,
      sessionId: importedSessionId,
      tabId: 11,
    }])
    assert.equal(spies.writes.userActions[0]?.sessionId, importedSessionId)
    assert.equal(spies.writes.networkEvents[0]?.sessionId, importedSessionId)
    assert.equal(spies.writes.replayEvents[0]?.sessionId, importedSessionId)
  } finally {
    spies.restore()
  }
})

test('importSessionArchive rejects wrapped archives without a session', async () => {
  const spies = installDbSpies()

  try {
    await assert.rejects(
      importSessionArchive(buildSessionArchive({ ...buildValidBundle(), session: undefined })),
      { message: 'Import file is missing session metadata' },
    )

    assert.equal(spies.transactionCalls, 0)
    assert.deepEqual(spies.writes, {
      sessions: [],
      tabs: [],
      userActions: [],
      networkEvents: [],
      replayEvents: [],
    })
  } finally {
    spies.restore()
  }
})

test('importSessionArchive rejects wrapped archives with non-array event collections', async () => {
  const spies = installDbSpies()

  try {
    const archive = buildSessionArchive(buildValidBundle()) as unknown as {
      bundle: Record<string, unknown>
    }
    archive.bundle.tabs = { bad: true }

    await assert.rejects(importSessionArchive(archive), { message: 'Invalid import file format' })

    assert.equal(spies.transactionCalls, 0)
    assert.deepEqual(spies.writes, {
      sessions: [],
      tabs: [],
      userActions: [],
      networkEvents: [],
      replayEvents: [],
    })
  } finally {
    spies.restore()
  }
})

test('importSessionArchive performs no writes when record validation fails before the transaction', async () => {
  const spies = installDbSpies()

  try {
    const bundle = buildValidBundle()
    const archive = buildSessionArchive({
      ...bundle,
      userActions: [{
        ...bundle.userActions[0],
        ts: Number.NaN,
      }],
    })

    await assert.rejects(importSessionArchive(archive), {
      message: 'Import validation failed: userActions[0].ts must be a finite number.',
    })

    assert.equal(spies.transactionCalls, 0)
    assert.deepEqual(spies.writes, {
      sessions: [],
      tabs: [],
      userActions: [],
      networkEvents: [],
      replayEvents: [],
    })
  } finally {
    spies.restore()
  }
})
