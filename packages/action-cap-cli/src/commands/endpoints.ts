import { defineCommand } from 'citty'
import { readArchive } from '../lib/archive.js'
import { apiEndpoints } from '../lib/views.js'
import { formatOutput, type OutputFormat } from '../lib/output.js'
import { fileArg, formatArgs } from '../lib/args.js'

export default defineCommand({
  meta: {
    name: 'endpoints',
    description: 'Deduplicated API endpoints with methods, statuses, and call counts',
  },
  args: {
    ...fileArg,
    ...formatArgs,
  },
  run: async (ctx) => {
    const { file, format } = ctx.args
    const bundle = await readArchive(file as string)
    const view = apiEndpoints(bundle)
    const output = formatOutput(view, format as OutputFormat)
    process.stdout.write(output + '\n')
  },
})
