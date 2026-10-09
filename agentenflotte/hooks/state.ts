// The mod's shared state: the keys every module reads, their initial values and the pure
// rules over them. The contract (types/index.d.ts, PluginState) types each key.
//
// The engine's scan reads a `read`/`update` source only from a const of the same file, and
// follows `$` only into functions of the same file, so nothing here is an atom or takes `$`.
// A module declares the atoms it reads itself, from these initials:
//   const settings = atom({ plugin: 'agentenflotte', key: 'settings' } as const, INITIAL.settings)
//   if (!isOn(await read($, settings), 'bruecke')) return next(e)
// fleet.ts and settings.ts alone write; everyone else reads.

import type { Alert, FleetSettings, Launch, Ship } from '../types'

export const DEFAULT_SETTINGS: FleetSettings = { all: true, bruecke: true, logbuch: true, computer: false }

/** The initial value of each key under plugin `agentenflotte`. */
export const INITIAL = {
  fleet: [] as Ship[],
  pending: [] as Launch[],
  settings: DEFAULT_SETTINGS,
  mainFailAt: null as number | null,
  contextLeft: null as number | null,
  isCompacting: false,
  alert: 'normal' as Alert,
}

/** The `$.store` key the switches persist under, so they hold across sessions. */
export const SETTINGS_KEY = 'settings'

/** How long a StopFailure of the main session keeps the bridge on red alert. */
export const MAIN_FAIL_MS = 15_000
/** Below this share of the context window left, in percent, the bridge goes to blue alert. */
export const LOW_CONTEXT_PERCENT = 20

// The fleet as last written, for lookups that must not wait on a read.
let mirror: readonly Ship[] = []

export function mirrored(): readonly Ship[] {
  return mirror
}

export function setMirror(list: readonly Ship[]) {
  mirror = list
}

export type Part = Exclude<keyof FleetSettings, 'all'>
export const PARTS: readonly Part[] = ['bruecke', 'logbuch', 'computer']

/** Whether a part of the mod is on: the main switch and its own. */
export function isOn(s: FleetSettings, part: Part): boolean {
  return s.all && s[part]
}

export type AlertInput = {
  fleet: readonly Ship[]
  now: number
  mainFailAt: number | null
  /** Context window left, in percent; null before the first measurement. */
  contextLeft: number | null
  isCompacting: boolean
}

/** The bridge's alert: red over yellow over blue over normal. */
export function alertOf(input: AlertInput): Alert {
  const failedLately = input.mainFailAt !== null && input.now - input.mainFailAt < MAIN_FAIL_MS
  if (failedLately || input.fleet.some(s => s.status === 'fail')) return 'rot'
  if (input.fleet.some(s => s.status === 'wait')) return 'gelb'
  if (input.isCompacting || (input.contextLeft !== null && input.contextLeft < LOW_CONTEXT_PERCENT)) return 'blau'
  return 'normal'
}
