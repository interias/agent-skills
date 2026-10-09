import { expect, mock, test } from 'claude-code/testing'

import { COLOR, ALERT_COLOR } from '../hooks/lexicon'
import { radarSvg } from '../hooks/taktik'
import type { Ship } from '../types'

const NOW = Date.UTC(2026, 9, 9)

const PANE = {
  component: 'Pane',
  requestId: 'taktik',
  props: { title: 'Taktisches Display', isFocused: false, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const cmd = (command: string, args = '') =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

const ship = (id: string, over: Partial<Ship> = {}): Ship => ({
  id, agentType: 'Explore', desc: 'Spawn-Logik suchen', model: 'haiku', effort: 1,
  variant: 0, status: 'run', startedAt: NOW, endedAt: null, ...over,
})

const text = async (handle: { drawn: () => Promise<unknown> }) => JSON.stringify(await handle.drawn())

// Answers the engine's pane calls and keeps the open ids.
async function setup($: any, on: any, settings: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, settings)
  const open = new Set<string>()
  on('ui.open', (_$: any, e: any) => (open.add(e.id), { value: { isPlaced: true } }) as never)
  on('ui.close', (_$: any, e: any) => (open.delete(e.id), { value: undefined }) as never)
  const redraws = { count: 0 }
  on('ui.invalidate', () => (redraws.count++, { value: undefined }) as never)
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.StopFailure', () => ({}))
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { clock, open, redraws }
}

const launch = async ($: any, id: string, over: { type?: string; desc?: string; model?: string; effort?: string } = {}) => {
  await $.tool.call({
    tool: 'Agent', description: over.desc ?? 'Spawn-Logik suchen', prompt: 'y',
    subagent_type: over.type ?? 'Explore', model: over.model ?? 'haiku', effort: over.effort ?? 'medium',
  })
  await $.classic.SubagentStart({ agent_id: id, agent_type: over.type ?? 'Explore' })
}

test('/taktik opens the pane and closes it when it is open', async ($, on) => {
  const { open } = await setup($, on)
  expect((await $.command.run(cmd('taktik'))).text).toBe('Taktisches Display geöffnet.')
  expect(open.has('taktik')).toBe(true)
  expect((await $.command.run(cmd('taktik'))).text).toBe('Taktisches Display geschlossen.')
  expect(open.has('taktik')).toBe(false)
})

test('/taktik opens nothing while the main switch is off', async ($, on) => {
  const { open } = await setup($, on, { settings: { all: false } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(cmd('taktik'))).text).toBe('Die Agentenflotte ist aus. Einschalten mit /flotte.')
  expect(open.size).toBe(0)
})

test('the desktop radar holds a contact per subagent with its color and status, and the station list', async ($, on) => {
  await setup($, on)
  await launch($, 'a1')
  await launch($, 'a2', { type: 'epic-implementer-standard', desc: 'Band umbauen', model: 'opus' })
  await launch($, 'a3', { type: 'Plan', desc: 'Epic zerlegen', model: 'sonnet' })
  await $.classic.PermissionRequest({ agent_id: 'a3', agent_type: 'Plan', tool_name: 'Bash', tool_input: {} } as never)
  await launch($, 'a4', { type: 'epic-reviewer-standard', desc: 'Review', model: 'fable' })
  await $.classic.StopFailure({ error: 'server_error', agent_id: 'a4' } as never)

  const desktop = await $.ui.mount({ plugin: 'agentenflotte', surface: 'desktop', ...PANE })
  const svg = await desktop.find({ type: 'Svg' })
  const source = String(svg?.props.source)
  expect(svg?.props.width).toBe(360)
  expect(svg?.props.height).toBe(360)
  expect(source).toContain('width="360" height="360" viewBox="0 0 360 360"')
  expect(source).toContain(COLOR.almond) // haiku
  expect(source).toContain(COLOR.gelb) // a3 waits
  expect(source).toContain('class="blink"')
  expect(source).toContain(COLOR.rot) // a4 failed
  expect(source).toContain(`stroke="${ALERT_COLOR.rot}"`) // the frame follows the alert
  expect(source).toContain('Modell: Opus')
  expect(source).toContain('Laufzeit 00:00')
  expect(source).not.toContain('Keine Kontakte')

  const tree = await text(desktop)
  for (const line of ['Wissenschaft: 1', 'Maschinenraum: 1', 'Taktik: 0', 'Navigation: 1', 'Brücke: 0', 'Alarmstufe Rot']) {
    expect(tree).toContain(line)
  }
  await desktop.unmount()
})

test('a done contact fades and its station no longer counts it', async ($, on) => {
  await setup($, on)
  await launch($, 'a1')
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: '', stop_hook_active: false })
  const desktop = await $.ui.mount({ plugin: 'agentenflotte', surface: 'desktop', ...PANE })
  expect(String((await desktop.find({ type: 'Svg' }))?.props.source)).toContain('class="fade"')
  expect(await text(desktop)).toContain('Wissenschaft: 0')
  await desktop.unmount()
})

test('without subagents the radar shows only the bridge and "Keine Kontakte"', async ($, on) => {
  await setup($, on)
  const desktop = await $.ui.mount({ plugin: 'agentenflotte', surface: 'desktop', ...PANE })
  const source = String((await desktop.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('Keine Kontakte')
  expect(source).toContain('Brücke (Hauptsitzung)')
  expect(source).not.toContain('<title>Spawn')
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'agentenflotte', surface: 'terminal', ...PANE })
  expect(await text(terminal)).toContain('Keine Kontakte')
  await terminal.unmount()
})

test('the terminal lists each station with warp, run time and "!" for a waiting subagent', async ($, on) => {
  const { clock } = await setup($, on)
  await launch($, 'a1', { effort: 'xhigh' })
  await launch($, 'a2', { type: 'Plan', desc: 'Epic zerlegen', model: 'opus' })
  await $.classic.PermissionRequest({ agent_id: 'a2', agent_type: 'Plan', tool_name: 'Bash', tool_input: {} } as never)
  await clock.advance(83_000)

  const terminal = await $.ui.mount({ plugin: 'agentenflotte', surface: 'terminal', ...PANE })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  const tree = await text(terminal)
  for (const line of ['Alarmstufe Gelb', 'Wissenschaft', 'Maschinenraum', 'Taktik', 'Navigation', 'Brücke', 'Spawn-Logik suchen', 'W8', '01:23']) {
    expect(tree).toContain(line)
  }
  expect(tree).toMatch(/Epic zerlegen[^"]*W4[^"]*01:23 !/)
  await terminal.unmount()
})

test('twelve ships and a waiting one stay within the Svg limit', async () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    ship(`a${i}`, { model: (['haiku', 'sonnet', 'opus', 'fable'] as const)[i % 4], desc: 'Eine recht lange Beschreibung des Auftrags', startedAt: NOW - i * 60_000 }),
  )
  const svg = radarSvg([...many, ship('w', { status: 'wait' })], NOW, 'gelb')
  expect(svg.source.length).toBeLessThan(131072)
  expect(svg.alt).toContain('13 Kontakte')
})

test('a contact keeps its angle and moves outward with its run time', async () => {
  const at = (ms: number) => radarSvg([ship('stable', { startedAt: NOW - ms })], NOW, 'normal').source
  const cx = (s: string) => Number(/<circle cx="([\d.]+)" cy="([\d.]+)" r="5"/.exec(s)?.[1])
  const cy = (s: string) => Number(/<circle cx="([\d.]+)" cy="([\d.]+)" r="5"/.exec(s)?.[2])
  const dist = (s: string) => Math.hypot(cx(s) - 180, cy(s) - 180)
  const [a, b, c] = [at(1_000), at(60_000), at(3_600_000)]
  expect(dist(a)).toBeLessThan(dist(b))
  expect(dist(b)).toBeLessThan(dist(c) + 0.01)
  expect(dist(c)).toBeLessThanOrEqual(165.5) // capped at the outer ring
  expect(Math.abs(Math.atan2(cy(a) - 180, cx(a) - 180) - Math.atan2(cy(c) - 180, cx(c) - 180))).toBeLessThan(0.05)
})

test('the animations are switched off under prefers-reduced-motion', async () => {
  const { source } = radarSvg([ship('a')], NOW, 'normal')
  expect(source).toContain('@media (prefers-reduced-motion:reduce){.sweep,.blink,.fade{animation:none}}')
})

test('a redraw keeps the phase of the sweep, the blink and the fade instead of starting them over', async () => {
  const at = (now: number) => radarSvg([ship('w', { status: 'wait' }), ship('d', { status: 'done', endedAt: NOW })], now, 'normal').source
  expect(at(NOW + 1_500)).toContain('class="sweep" style="animation-delay:-1.5s"')
  expect(at(NOW + 1_500)).toContain('class="blink" style="animation-delay:-0.5s"')
  expect(at(NOW + 1_500)).toContain('class="fade" opacity=".35" style="animation-delay:-1.5s"')
  expect(at(NOW + 9_000)).toContain('class="fade" opacity=".35" style="animation-delay:-2s"') // the fade is over after two seconds
})

test('the ticker draws the open pane again every ten seconds, never the other drawings, and stops once it is closed', async ($, on) => {
  const { clock, redraws } = await setup($, on)
  await launch($, 'a1')
  await $.command.run(cmd('taktik'))
  const terminal = await $.ui.mount({ plugin: 'agentenflotte', surface: 'terminal', ...PANE })
  expect(await text(terminal)).toContain('00:00')
  await clock.advance(10_000)
  expect(await text(terminal)).toContain('00:10')
  await clock.advance(10_000)
  expect(await text(terminal)).toContain('00:20')

  await $.command.run(cmd('taktik'))
  await clock.advance(30_000)
  expect(await text(terminal)).toContain('00:20') // no beat after the close
  expect(redraws.count).toBe(0) // `ui.invalidate('ui.render')` would draw every other drawing of the mod again too
  await terminal.unmount()
})
