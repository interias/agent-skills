// `/flotte`, the mod's switchboard: the main switch, one switch per part, and their status.
// The switches persist in the plugin's store and load at every session start.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { FleetSettings } from '../types'
import { DEFAULT_SETTINGS, INITIAL, PARTS, SETTINGS_KEY } from './state'
import type { Part } from './state'

const settings = atom({ plugin: 'agentenflotte', key: 'settings' } as const, INITIAL.settings)

export const PART_LABEL: Record<Part, string> = {
  band: 'Band',
  bruecke: 'Brücke',
  logbuch: 'Logbuch',
  computer: 'Bordcomputer',
}

const HELP = 'Gültig: /flotte · /flotte status · /flotte <band|bruecke|logbuch|computer> [an|aus]'
const onOff = (v: boolean) => (v ? 'an' : 'aus')

/** What `/flotte <args>` does to the switches: the new switches (null when unchanged) and the reply. */
export function flotte(args: string, current: FleetSettings): { settings: FleetSettings | null; text: string } {
  const [word = '', state, ...rest] = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (word === '') {
    const all = !current.all
    return { settings: { ...current, all }, text: all ? 'Agentenflotte eingeblendet.' : 'Agentenflotte ausgeblendet.' }
  }
  if (word === 'status' && state === undefined) {
    const lines = [`Hauptschalter: ${onOff(current.all)}`, ...PARTS.map(p => `${PART_LABEL[p]}: ${onOff(current[p])}`)]
    return { settings: null, text: lines.join('\n') }
  }
  const part = (word === 'brücke' ? 'bruecke' : word) as Part
  if (!PARTS.includes(part) || rest.length > 0 || (state !== undefined && state !== 'an' && state !== 'aus')) {
    return { settings: null, text: HELP }
  }
  const value = state === undefined ? !current[part] : state === 'an'
  return { settings: { ...current, [part]: value }, text: `${PART_LABEL[part]} ${onOff(value)}.` }
}

/** Stored switches over the defaults; anything malformed falls back to the default. */
export function settingsFrom(stored: unknown): FleetSettings {
  const out = { ...DEFAULT_SETTINGS }
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(out) as (keyof FleetSettings)[]) {
      const v = (stored as Record<string, unknown>)[key]
      if (typeof v === 'boolean') out[key] = v
    }
  }
  return out
}

async function load($: EngineInterface) {
  const loaded = settingsFrom(await $.store.get(SETTINGS_KEY))
  await update($, settings, () => loaded)
}

async function save($: EngineInterface, value: FleetSettings) {
  await update($, settings, () => value)
  await $.store.set(SETTINGS_KEY, value)
}

export function registerSettings(on: On) {
  on('session.start', async ($, e, next) => {
    await load($)
    await $.command.register({
      name: 'flotte',
      description: 'Agentenflotte ein- oder ausblenden, einzelne Teile schalten',
      argumentHint: '[status | band|bruecke|logbuch|computer [an|aus]]',
    })
    return next(e)
  })

  on('command.run', { command: 'flotte' }, async ($, e) => {
    const res = flotte(e.args, await read($, settings))
    if (res.settings) await save($, res.settings)
    return { text: res.text }
  })
}
