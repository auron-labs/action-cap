import { defineCommand } from 'citty'
import { readArchive } from '../lib/archive.js'
import { actionTimeline } from '../lib/views.js'
import { formatOutput, type OutputFormat } from '../lib/output.js'
import { fileArg, formatArgs, parseFilterOptions } from '../lib/args.js'

export default defineCommand({
  meta: {
    name: 'actions',
    description: 'Chronological user action timeline (clicks, inputs, navigations)',
  },
  args: {
    ...fileArg,
    ...formatArgs,
    'include-scroll': { type: 'boolean', description: 'Include scroll events (excluded by default)', default: false },
    tab: { type: 'string', description: 'Filter to a specific tab ID' },
    type: { type: 'string', description: 'Filter by event type (comma-separated)' },
    from: { type: 'string', description: 'Start timestamp (ms since epoch)' },
    to: { type: 'string', description: 'End timestamp (ms since epoch)' },
    limit: { type: 'string', description: 'Max events to output' },
  },
  run: async (ctx) => {
    const { file, format, includeScroll } = ctx.args
    const opts = parseFilterOptions(ctx.args)
    const bundle = await readArchive(file as string)
    const view = actionTimeline(bundle, { ...opts, includeScroll: includeScroll as boolean })
    const output = formatOutput(view, format as OutputFormat)
    process.stdout.write(output + '\n')
  },
})
