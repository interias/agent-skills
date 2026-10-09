import { expect, mock, test } from 'claude-code/testing'

import { ALERT_COLOR, ALERT_LABEL, COLOR, stardate, stationOf, warpOf } from '../hooks/lexicon'
import { DEFAULT_SETTINGS, MAIN_FAIL_MS, alertOf, isOn } from '../hooks/state'
import type { AlertInput } from '../hooks/state'
import type { Ship } from '../types'

const ship = (id: string, over: Partial<Ship> = {}): Ship => ({
  id, agentType: 'Explore', desc: 'Spawn-Logik suchen', model: 'haiku', effort: 1,
  variant: 0, status: 'run', startedAt: 0, endedAt: null, ...over,
})

const run = (args = '') =>
  ({ command: 'flotte', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

const calm: AlertInput = { fleet: [ship('a')], now: 100_000, mainFailAt: null, contextLeft: 80, isCompacting: false }

test('the stardate counts a thousand per year from 41000 in 1987', async () => {
  expect(stardate(Date.UTC(1987, 0, 1))).toBe('41000.0')
  expect(stardate(Date.UTC(2026, 9, 9))).toBe('80769.9')
  expect(stardate(Date.UTC(2026, 6, 2, 12))).toBe('80500.0')
})

test('the warp factor follows the WARP table and clamps', async () => {
  expect([0, 1, 2, 3, 4].map(warpOf)).toEqual(['2', '4', '6', '8', '9,9'])
  expect(warpOf(-1)).toBe('2')
  expect(warpOf(9)).toBe('9,9')
})

test('each agent type serves at its station', async () => {
  expect(stationOf('Explore')).toBe('Wissenschaft')
  expect(stationOf('Kundschafter')).toBe('Wissenschaft')
  expect(stationOf('epic-kundschafter')).toBe('Wissenschaft')
  expect(stationOf('epic-implementer-urteil')).toBe('Maschinenraum')
  expect(stationOf('epic-reviewer-standard')).toBe('Taktik')
  expect(stationOf('Plan')).toBe('Navigation')
  expect(stationOf('Planer')).toBe('Navigation')
  expect(stationOf('epic-lauf')).toBe('Navigation')
  expect(stationOf('general-purpose')).toBe('Brücke')
  expect(stationOf('explanation-writer')).toBe('Brücke')
})

test('each alert level has a name and a color from the palette', async () => {
  expect(ALERT_LABEL).toEqual({ normal: 'Normalbetrieb', gelb: 'Alarmstufe Gelb', rot: 'Alarmstufe Rot', blau: 'Alarmstufe Blau' })
  expect(ALERT_COLOR.rot).toBe(COLOR.rot)
  expect(ALERT_COLOR.gelb).toBe('#ffcc33')
  expect(ALERT_COLOR.blau).toBe('#2288ff')
})

test('the alert reads each level from its inputs', async () => {
  expect(alertOf(calm)).toBe('normal')
  expect(alertOf({ ...calm, fleet: [ship('a', { status: 'fail' })] })).toBe('rot')
  expect(alertOf({ ...calm, mainFailAt: calm.now - 1000 })).toBe('rot')
  expect(alertOf({ ...calm, mainFailAt: calm.now - MAIN_FAIL_MS })).toBe('normal')
  expect(alertOf({ ...calm, fleet: [ship('a', { status: 'wait' })] })).toBe('gelb')
  expect(alertOf({ ...calm, contextLeft: 19 })).toBe('blau')
  expect(alertOf({ ...calm, contextLeft: 20 })).toBe('normal')
  expect(alertOf({ ...calm, contextLeft: null })).toBe('normal')
  expect(alertOf({ ...calm, isCompacting: true })).toBe('blau')
})

test('red outranks yellow outranks blue', async () => {
  const all: AlertInput = { ...calm, fleet: [ship('a', { status: 'wait' }), ship('b', { status: 'fail' })], isCompacting: true }
  expect(alertOf(all)).toBe('rot')
  expect(alertOf({ ...all, fleet: [ship('a', { status: 'wait' })] })).toBe('gelb')
  expect(alertOf({ ...all, fleet: [ship('a', { status: 'wait' })], mainFailAt: calm.now })).toBe('rot')
})

test('a part is on only under the main switch', async () => {
  expect(isOn(DEFAULT_SETTINGS, 'bruecke')).toBe(true)
  expect(isOn(DEFAULT_SETTINGS, 'computer')).toBe(false)
  expect(isOn({ ...DEFAULT_SETTINGS, all: false }, 'bruecke')).toBe(false)
})

test('/flotte toggles the main switch, sets parts and reports their status', async ($, on) => {
  mock.store(on)
  const flotte = async (args: string) => (await $.command.run(run(args))).text

  expect(await flotte('')).toBe('Agentenflotte ausgeblendet.')
  expect(await flotte('')).toBe('Agentenflotte eingeblendet.')
  expect(await flotte('computer an')).toBe('Bordcomputer an.')
  expect(await flotte('logbuch')).toBe('Logbuch aus.')
  expect(await flotte('Brücke aus')).toBe('Brücke aus.')
  expect(await flotte('status')).toBe('Hauptschalter: an\nBrücke: aus\nLogbuch: aus\nBordcomputer: an')
  for (const bad of ['warp', 'band', 'logbuch vielleicht', 'logbuch an jetzt', 'status logbuch']) {
    expect(await flotte(bad)).toContain('Gültig: /flotte')
  }
})

test('the switches persist in the store and load at session start', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on, { settings: { ...DEFAULT_SETTINGS, logbuch: false } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(run('status'))).text).toContain('Logbuch: aus')

  await $.command.run(run('logbuch an'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(run('status'))).text).toContain('Logbuch: an')
})

test('a malformed stored entry falls back to the defaults, key by key', async ($, on) => {
  mock.store(on, { settings: { all: 'ja', logbuch: false, computer: 1 } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(run('status'))).text).toBe('Hauptschalter: an\nBrücke: an\nLogbuch: aus\nBordcomputer: aus')
})

test('a failure of the main session holds red alert for its time, then clears on the clock alone', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  on('classic.StopFailure', () => ({}))
  let level: unknown = 'normal'
  on('state.set', { plugin: 'agentenflotte', key: 'alert' }, ($, e, next) => {
    level = e.value
    return next(e)
  })

  await $.classic.StopFailure({ error: 'server_error' })
  expect(level).toBe('rot')
  await clock.advance(MAIN_FAIL_MS - 1)
  expect(level).toBe('rot')
  await clock.advance(1)
  expect(level).toBe('normal')
})
