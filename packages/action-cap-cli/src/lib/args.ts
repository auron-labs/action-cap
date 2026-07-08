import type { ArgsDef } from 'citty'
import type { FilterOptions } from './filters.js'

export const filterArgs = {
  tab: { type: 'string' as const, description: 'Filter to a specific tab ID' },
  type: { type: 'string' as const, description: 'Filter by event type (comma-separated, e.g. click,input)' },
  status: { type: 'string' as const, description: 'Filter network by status (e.g. 4xx, 5xx, 200, >=400)' },
  from: { type: 'string' as const, description: 'Start timestamp (ms since epoch)' },
  to: { type: 'string' as const, description: 'End timestamp (ms since epoch)' },
  limit: { type: 'string' as const, description: 'Max events to output' },
} satisfies ArgsDef

export const formatArgs = {
  format: { type: 'string' as const, description: 'Output format: json, table, toon', default: 'json' },
  verbose: { type: 'boolean' as const, description: 'Verbose logging to stderr', default: false },
} satisfies ArgsDef

export const fileArg = {
  file: { type: 'positional' as const, description: 'Path to .bxdac or .json archive', required: true },
} satisfies ArgsDef

export function parseFilterOptions(args: Record<string, unknown>): FilterOptions {
  return {
    tab: args.tab ? Number(args.tab) : undefined,
    type: args.type ? String(args.type) : undefined,
    status: args.status ? String(args.status) : undefined,
    from: args.from ? Number(args.from) : undefined,
    to: args.to ? Number(args.to) : undefined,
    limit: args.limit ? Number(args.limit) : undefined,
  }
}
