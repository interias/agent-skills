import { expect, mock, test } from 'claude-code/testing'

import { ALERT_COLOR, ALERT_LABEL } from '../hooks/lexicon'
import { frame } from '../hooks/raster'
import { fleetSvg } from '../hooks/svg'
import type { Ship } from '../types'

const ship = (id: string, over: Partial<Ship> = {}): Ship => ({
  id, agentType: 'Explore', desc: 'Spawn-Logik suchen', model: 'haiku', effort: 1,
  variant: 0, status: 'run', startedAt: 0, endedAt: null, ...over,
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('the cap and bar wear the alert color, and a waiting subagent turns the band yellow', async ($, on) => {
  mock.clock(on, { now: 10_000 })
  on('classic.SubagentStart', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  await $.tool.call({ tool: 'Agent', description: 'Epic zerlegen', prompt: 'x', subagent_type: 'Plan', model: 'opus', effort: 'high' })
  await $.classic.SubagentStart({ agent_id: 'ag1', agent_type: 'Plan' })

  const source = async () => {
    const m = await $.ui.mount({ plugin: 'agentenflotte', surface: 'desktop', ...BAND })
    const src = String((await m.find({ type: 'Svg' }))?.props.source)
    await m.unmount()
    return src
  }
  const calm = await source()
  expect(calm).toContain(`fill="${ALERT_COLOR.normal}"`)
  expect(calm).toContain('>FLOTTE<')
  expect(calm).toContain('1 IM EINSATZ')

  await $.classic.PermissionRequest({ agent_id: 'ag1', agent_type: 'Plan', tool_name: 'Bash', tool_input: {} } as never)
  const yellow = await source()
  expect(yellow).toContain(`fill="${ALERT_COLOR.gelb}"`)
  expect(yellow).not.toContain(`fill="${ALERT_COLOR.normal}"`)
  expect(yellow).toContain(ALERT_LABEL.gelb)
  expect(yellow).not.toContain('>FLOTTE<')
})

test('the roster names station, description and warp; a waiting pill carries a bang', async () => {
  const svg = fleetSvg([
    ship('a', { agentType: 'Explore', desc: 'Spawn-Logik suchen', effort: 4 }),
    ship('b', { agentType: 'epic-reviewer-standard', desc: 'Paket prüfen', model: 'opus', status: 'wait' }),
    ship('c', { agentType: 'Plan', desc: 'Kurs setzen', model: 'sonnet', status: 'fail' }),
  ], 5000, true)
  expect(svg.source).toContain('Wissenschaft · Spawn-Logik suchen · W9,9')
  expect(svg.source).toContain('>! Taktik · Paket prüfen · W4<')
  expect(svg.source).toContain('class="pill wait"')
  expect(svg.source).toContain('class="pill lost"')
  expect(svg.source).toContain('fill="#fcc19f"')
})

test('the cap reads BEREIT without subagents', async () => {
  const svg = fleetSvg([], 1000, false)
  expect(svg.source).toContain('BEREIT')
  expect(svg.source).not.toContain('IM EINSATZ')
})

test('the data cascade flickers only while working and every animation yields to reduced motion', async () => {
  const working = fleetSvg([ship('a')], 5000, true).source
  const idle = fleetSvg([ship('a')], 5000, false).source
  expect(working).toContain('class="cascade on"')
  expect(idle).toContain('class="cascade"')
  expect(idle).not.toContain('class="cascade on"')
  expect(working).toContain('steps(1)')
  expect(working).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important\}\}/)
})

test('twelve ships stay within the Svg limit, and surplus pills collapse into "+n weitere"', async () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    ship(`a${i}`, { model: (['haiku', 'sonnet', 'opus', 'fable'] as const)[i % 4], agentType: 'epic-implementer-standard', desc: 'Eine lange Beschreibung hier' }),
  )
  const svg = fleetSvg(many, 5000, true, 'rot')
  expect(svg.source.length).toBeLessThan(131072)
  expect(svg.source).toContain('width="960" height="240" ')
  expect(svg.source).toMatch(/\+\d+ weitere/)
  expect(svg.source.match(/class="pill/g)!.length).toBeLessThanOrEqual(13)
})

test('the terminal caption names the warp of each ship and leads with the alert', async () => {
  const f = frame([ship('a', { effort: 3 })], 5000, 120, true, 'gelb')
  expect(f.labels.startsWith(ALERT_LABEL.gelb)).toBe(true)
  expect(f.labels).toContain(' W8')
  expect(f.labels).toContain('HAUPTSITZUNG')
  expect(frame([ship('a')], 5000, 120, true).labels).not.toContain('Alarmstufe')
})
