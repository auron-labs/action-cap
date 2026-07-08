import { defineCommand } from 'citty'
import { readArchive } from '../lib/archive.js'
import { networkRequests } from '../lib/views.js'
import { formatOutput, type OutputFormat } from '../lib/output.js'
import { fileArg, formatArgs, parseFilterOptions } from '../lib/args.js'

export default defineCommand({
  meta: {
    name: 'network',
    description: 'All network requests with method, URL, status, timing',
  },
  args: {
    ...fileArg,
    ...formatArgs,
    headers: { type: 'boolean', description: 'Include request/response headers (excluded by default)', default: false },
    tab: { type: 'string', description: 'Filter to a specific tab ID' },
    status: { type: 'string', description: 'Filter network by status (e.g. 4xx, 5xx, 200, >=400)' },
    from: { type: 'string', description: 'Start timestamp (ms since epoch)' },
    to: { type: 'string', description: 'End timestamp (ms since epoch)' },
    limit: { type: 'string', description: 'Max events to output' },
  },
  run: async (ctx) => {
    const { file, format, headers } = ctx.args
    const opts = parseFilterOptions(ctx.args)
    const bundle = await readArchive(file as string)
    const view = networkRequests(bundle, { ...opts, headers: headers as boolean })
    const output = formatOutput(view, format as OutputFormat)
    process.stdout.write(output + '\n')
  },
})
