import { defineCommand } from 'citty'
import { readArchive } from '../lib/archive.js'
import { replayMetadata } from '../lib/views.js'
import { formatOutput, type OutputFormat } from '../lib/output.js'
import { fileArg, formatArgs } from '../lib/args.js'

export default defineCommand({
  meta: {
    name: 'replay',
    description: 'rrweb replay event metadata (count, time range, size)',
  },
  args: {
    ...fileArg,
    ...formatArgs,
    full: { type: 'boolean', description: 'Output raw rrweb event payloads (TOON-compressed)', default: false },
    tab: { type: 'string', description: 'Filter to a specific tab ID' },
    from: { type: 'string', description: 'Start timestamp (ms since epoch)' },
    to: { type: 'string', description: 'End timestamp (ms since epoch)' },
    limit: { type: 'string', description: 'Max events to output' },
  },
  run: async (ctx) => {
    const { file, format, full } = ctx.args
    const bundle = await readArchive(file as string)
    const view = replayMetadata(bundle, { full: full as boolean })
    const output = formatOutput(view, format as OutputFormat)
    process.stdout.write(output + '\n')
  },
})
