import { defineCommand } from 'citty'
import { readArchive } from '../lib/archive.js'
import { sessionSummary } from '../lib/views.js'
import { formatOutput, type OutputFormat } from '../lib/output.js'
import { fileArg, formatArgs, parseFilterOptions } from '../lib/args.js'

export default defineCommand({
  meta: {
    name: 'summary',
    description: 'Session overview: metadata, duration, counts, tabs, time range',
  },
  args: {
    ...fileArg,
    ...formatArgs,
    tab: { type: 'string', description: 'Filter to a specific tab ID' },
    type: { type: 'string', description: 'Filter by event type (comma-separated)' },
    status: { type: 'string', description: 'Filter network by status (e.g. 4xx, 5xx, 200, >=400)' },
    from: { type: 'string', description: 'Start timestamp (ms since epoch)' },
    to: { type: 'string', description: 'End timestamp (ms since epoch)' },
    limit: { type: 'string', description: 'Max events to output' },
  },
  run: async (ctx) => {
    const { file, format, ...rest } = ctx.args
    const bundle = await readArchive(file as string)
    const view = sessionSummary(bundle)
    const output = formatOutput(view, format as OutputFormat)
    process.stdout.write(output + '\n')
  },
})
