import { readFile } from 'node:fs/promises'
import { extname } from 'pathe'
import { z } from 'zod'
import type { SessionArchive, SessionBundle } from '../types.js'

const ElementSnapshotSchema = z
  .object({
    tagName: z.string().optional(),
    text: z.string().optional(),
    id: z.string().optional(),
    className: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough()

const UserActionEventSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    tabId: z.number(),
    frameId: z.number().optional().default(0),
    ts: z.number(),
    type: z.string(),
    url: z.string().optional(),
    title: z.string().optional(),
    selector: z.string().optional(),
    element: ElementSnapshotSchema.optional(),
    coordinates: z
      .object({ x: z.number(), y: z.number() })
      .passthrough()
      .optional(),
    scroll: z
      .object({ x: z.number(), y: z.number() })
      .passthrough()
      .optional(),
    value: z.string().optional(),
    masked: z.boolean().optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.undefined()])).optional(),
  })
  .passthrough()

const NetworkEventSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    tabId: z.number(),
    requestId: z.string(),
    ts: z.number(),
    phase: z.string(),
    url: z.string(),
    method: z.string().optional(),
    status: z.number().optional(),
    statusText: z.string().optional(),
    resourceType: z.string().optional(),
    mimeType: z.string().optional(),
    requestHeaders: z.record(z.string(), z.string()).optional(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    requestBody: z.string().optional(),
    responseBody: z.string().optional(),
    bodyEncoding: z.string().optional(),
    durationMs: z.number().optional(),
    initiator: z.string().optional(),
    truncated: z.boolean().optional(),
    errorText: z.string().optional(),
  })
  .passthrough()

const TrackedTabRecordSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    tabId: z.number(),
    windowId: z.number(),
    title: z.string().optional(),
    url: z.string().optional(),
    faviconUrl: z.string().optional(),
    attachedDebugger: z.boolean().optional(),
    firstSeenAt: z.number(),
    lastSeenAt: z.number(),
  })
  .passthrough()

const SessionRecordSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    scope: z.string(),
    status: z.string(),
    startTime: z.number(),
    endTime: z.number().optional(),
    startTabId: z.number().optional(),
    startWindowId: z.number().optional(),
    tabCount: z.number().optional(),
    actionCount: z.number().optional(),
    networkCount: z.number().optional(),
    replayCount: z.number().optional(),
  })
  .passthrough()

const ReplayEventRecordSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    tabId: z.number(),
    ts: z.number(),
    payload: z.unknown(),
  })
  .passthrough()

const SessionBundleSchema = z
  .object({
    session: SessionRecordSchema.optional(),
    tabs: z.array(TrackedTabRecordSchema).optional().default([]),
    userActions: z.array(UserActionEventSchema).optional().default([]),
    networkEvents: z.array(NetworkEventSchema).optional().default([]),
    replayEvents: z.array(ReplayEventRecordSchema).optional().default([]),
  })
  .passthrough()

const SessionArchiveSchema = z
  .object({
    format: z.literal('actioncap-session-archive'),
    version: z.literal(1),
    exportedAt: z.number(),
    bundle: SessionBundleSchema,
  })
  .passthrough()

export class ArchiveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ArchiveError'
  }
}

export async function readArchive(filePath: string): Promise<SessionBundle> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new ArchiveError(`Failed to read file: ${filePath}`, { cause: err })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new ArchiveError(`Failed to parse JSON: ${filePath}`, { cause: err })
  }

  return parseArchive(parsed, filePath)
}

export function parseArchive(parsed: unknown, filePath?: string): SessionBundle {
  const result = SessionArchiveSchema.safeParse(parsed)
  if (!result.success) {
    throw new ArchiveError(
      `Invalid archive format${filePath ? ` in ${filePath}` : ''}: ${result.error.message}`,
      { cause: result.error },
    )
  }

  const archive = result.data as unknown as SessionArchive
  return archive.bundle
}

export function isArchiveFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ext === '.bxdac' || ext === '.json'
}
