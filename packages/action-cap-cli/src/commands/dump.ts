import { defineCommand } from 'citty'
import { readArchive } from '../lib/archive.js'
import { fullDump } from '../lib/views.js'
import { formatOutput, type OutputFormat } from '../lib/output.js'
import { fileArg, formatArgs } from '../lib/args.js'

export default defineCommand({
  meta: {
    name: 'dump',
    description: 'Complete archive dump (TOON-compressed by default)',
  },
  args: {
    ...fileArg,
    ...formatArgs,
    'no-replay': { type: 'boolean', description: 'Exclude rrweb replay events (reduces size significantly)', default: false },
  },
  run: async (ctx) => {
    const { file, format, noReplay } = ctx.args
    const bundle = await readArchive(file as string)
    const view = fullDump(bundle, { noReplay: noReplay as boolean })
    const output = formatOutput(view, format as OutputFormat)
    process.stdout.write(output + '\n')
  },
})
