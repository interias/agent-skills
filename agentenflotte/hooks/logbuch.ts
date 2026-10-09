// The log (P4): a log line after every answer (turn.complete) and `/logbuch`. Only while
// isOn($, 'logbuch'). The line is made from counters, never from a model call.

import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { stardate } from './lexicon'
import { INITIAL, isOn } from './state'

const settings = atom({ plugin: 'agentenflotte', key: 'settings' } as const, INITIAL.settings)

const STORE_KEY = 'logbuch'
const KEEP = 200
const SHOWN = 10
const SHOWN_ALL = 50

type Entry = { stardate: string; at: number; text: string }
type Counts = { started: number; returned: number; failed: number; waiting: number }

const zero = (): Counts => ({ started: 0, returned: 0, failed: 0, waiting: 0 })

// Counted since the main session's turn began; a reload starts a fresh count.
let counts = zero()

/** The log text for the counts, null when nothing happened. */
export function logLine(c: Counts, date: string): string | null {
  const parts = [
    c.started > 0 && `${c.started} ${c.started === 1 ? 'Shuttle' : 'Shuttles'} gestartet`,
    c.returned > 0 && `${c.returned} zurück an Bord`,
    c.failed > 0 && `${c.failed} ausgefallen`,
    c.waiting > 0 && `${c.waiting} ${c.waiting === 1 ? 'wartet' : 'warten'} auf Autorisierung`,
  ].filter(Boolean)
  return parts.length === 0 ? null : `Logbuch, Sternzeit ${date}: ${parts.join(', ')}.`
}

/** What `/logbuch [alle]` shows: the newest entries first. */
export function logbuchText(entries: readonly Entry[], all: boolean, isLogOn: boolean): string {
  const lines =
    entries.length === 0
      ? ['Noch keine Einträge im Logbuch.']
      : entries.slice(-(all ? SHOWN_ALL : SHOWN)).reverse().map(e => e.text)
  if (!isLogOn) lines.push('Das Logbuch ist aus. Einschalten mit /flotte logbuch an.')
  return lines.join('\n')
}

async function entriesOf($: { store: { get(key: string): Promise<unknown> } }): Promise<Entry[]> {
  const stored = await $.store.get(STORE_KEY)
  return Array.isArray(stored) ? (stored as Entry[]) : []
}

export function registerLogbuch(on: On) {
  on('session.start', {}, async ($, e, next) => {
    await $.command.register({
      name: 'logbuch',
      description: 'Die letzten Logbuch-Einträge der Agentenflotte zeigen',
      argumentHint: '[alle]',
    })
    return next(e)
  })

  on('command.run', { command: 'logbuch' }, async ($, e) => {
    const all = e.args.trim().toLowerCase() === 'alle'
    return { text: logbuchText(await entriesOf($), all, isOn(await read($, settings), 'logbuch')) }
  })

  on('turn.start', {}, async ($, e, next) => {
    counts = zero()
    return next(e)
  })

  on('classic.SubagentStart', {}, async ($, e, next) => {
    counts.started += 1
    return next(e)
  })
  on('classic.SubagentStop', {}, async ($, e, next) => {
    counts.returned += 1
    return next(e)
  })
  on('classic.StopFailure', {}, async ($, e, next) => {
    if (e.agent_id) counts.failed += 1
    return next(e)
  })
  on('classic.PermissionRequest', {}, async ($, e, next) => {
    if (e.agent_id) counts.waiting += 1
    return next(e)
  })

  on('turn.complete', {}, async ($, e, next) => {
    const res = await next(e)
    if (e.agentId || !isOn(await read($, settings), 'logbuch')) return res
    const now = await $.clock.now()
    const date = stardate(now)
    const text = logLine(counts, date)
    counts = zero()
    if (!text) return res
    const entry: Entry = { stardate: date, at: now, text }
    await $.store.set(STORE_KEY, [...(await entriesOf($)), entry].slice(-KEEP))
    return { ...res, text }
  })
}
