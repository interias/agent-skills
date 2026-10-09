import type { Register } from 'claude-code'

import { registerBand } from './band'
import { registerBruecke } from './bruecke'
import { registerComputer } from './computer'
import { registerFleet } from './fleet'
import { registerLogbuch } from './logbuch'
import { registerSettings } from './settings'
import { registerTaktik } from './taktik'

// Each feature registers its own hooks. A plugin's registrations on one event nest in this
// order, first outermost: the switches load and the fleet updates before any feature runs.
// A pattern may be registered once per plugin without a matcher (a second one fails the
// load); settings.ts and fleet.ts hold those, so every other module hooks with a matcher,
// `{}` where nothing narrows: on('session.start', {}, …), on('classic.SubagentStop', {}, …).
export const register: Register = on => {
  registerSettings(on)
  registerFleet(on)
  registerBand(on)
  registerBruecke(on)
  registerLogbuch(on)
  registerComputer(on)
  registerTaktik(on)
}
