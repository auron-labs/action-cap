import { defineCommand } from 'citty'
import { readArchive } from '../lib/archive.js'
import { navigationFlow } from '../lib/views.js'
import { formatOutput, type OutputFormat } from '../lib/output.js'
import { fileArg, formatArgs } from '../lib/args.js'

export default defineCommand({
  meta: {
    name: 'navigation',
    description: 'Navigation and tab lifecycle events showing URL transitions',
  },
  args: {
    ...fileArg,
    ...formatArgs,
    tab: { type: 'string', description: 'Filter to a specific tab ID' },
    from: { type: 'string', description: 'Start timestamp (ms since epoch)' },
    to: { type: 'string', description: 'End timestamp (ms since epoch)' },
    limit: { type: 'string', description: 'Max events to output' },
  },
  run: async (ctx) => {
    const { file, format } = ctx.args
    const bundle = await readArchive(file as string)
    const view = navigationFlow(bundle)
    const output = formatOutput(view, format as OutputFormat)
    process.stdout.write(output + '\n')
  },
})
