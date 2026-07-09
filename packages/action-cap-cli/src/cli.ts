#!/usr/bin/env node

import { defineCommand, runMain } from 'citty'
import summary from './commands/summary.js'
import actions from './commands/actions.js'
import network from './commands/network.js'
import errors from './commands/errors.js'
import endpoints from './commands/endpoints.js'
import forms from './commands/forms.js'
import navigation from './commands/navigation.js'
import elements from './commands/elements.js'
import tabs from './commands/tabs.js'
import replay from './commands/replay.js'
import dump from './commands/dump.js'

const main = defineCommand({
  subCommands: {
    summary,
    actions,
    network,
    errors,
    endpoints,
    forms,
    navigation,
    elements,
    tabs,
    replay,
    dump,
  },
})

runMain(main)
