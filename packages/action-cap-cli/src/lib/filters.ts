import type { ActionType, NetworkEvent, UserActionEvent } from '../types.js'

export interface FilterOptions {
  tab?: number
  type?: string
  status?: string
  from?: number
  to?: number
  limit?: number
}

interface Timestamped {
  ts: number
}

interface Typed {
  type: string
}

interface Tabbed {
  tabId: number
}

interface Statused {
  status?: number
}

export function byTab<T extends Tabbed>(items: T[], tabId?: number): T[] {
  if (tabId === undefined) return items
  return items.filter((item) => item.tabId === tabId)
}

export function byType<T extends Typed>(items: T[], types?: string): T[] {
  if (!types) return items
  const set = new Set(
    types
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  )
  return items.filter((item) => set.has(item.type))
}

export function parseStatusFilter(filter: string): (status: number) => boolean {
  const normalized = filter.trim().toLowerCase()

  const match = normalized.match(/^(>=?)(\d+)$/)
  if (match) {
    const op = match[1]
    const threshold = Number(match[2])
    return op === '>' ? (s) => s > threshold : (s) => s >= threshold
  }

  if (/^\d{3}$/.test(normalized)) {
    const code = Number(normalized)
    return (s) => s === code
  }

  const rangeMatch = normalized.match(/^(\d)(xx)$/)
  if (rangeMatch) {
    const digit = Number(rangeMatch[1])
    const min = digit * 100
    const max = min + 99
    return (s) => s >= min && s <= max
  }

  throw new Error(`Invalid status filter: ${filter}. Use formats like 4xx, 5xx, 200, >=400`)
}

export function byStatus<T extends Statused>(items: T[], statusFilter?: string): T[] {
  if (!statusFilter) return items
  const matches = parseStatusFilter(statusFilter)
  return items.filter((item) => item.status !== undefined && matches(item.status))
}

export function byTimeRange<T extends Timestamped>(items: T[], from?: number, to?: number): T[] {
  return items.filter((item) => {
    if (from !== undefined && item.ts < from) return false
    if (to !== undefined && item.ts > to) return false
    return true
  })
}

export function withLimit<T>(items: T[], limit?: number): T[] {
  if (limit === undefined || limit <= 0) return items
  return items.slice(0, limit)
}

export function applyActionFilters(actions: UserActionEvent[], opts: FilterOptions): UserActionEvent[] {
  let result = actions
  result = byTab(result, opts.tab)
  result = byType(result, opts.type)
  result = byTimeRange(result, opts.from, opts.to)
  result = withLimit(result, opts.limit)
  return result
}

export function applyNetworkFilters(events: NetworkEvent[], opts: FilterOptions): NetworkEvent[] {
  let result = events
  result = byTab(result, opts.tab)
  result = byStatus(result, opts.status)
  result = byTimeRange(result, opts.from, opts.to)
  result = withLimit(result, opts.limit)
  return result
}

export function parseTypes(typeStr?: string): Set<string> | undefined {
  if (!typeStr) return undefined
  return new Set(
    typeStr
      .split(',')
      .map((t) => t.trim() as ActionType)
      .filter(Boolean),
  )
}
