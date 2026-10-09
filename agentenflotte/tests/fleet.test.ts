import { expect, mock, test } from 'claude-code/testing'

import { ROWS, frame } from '../hooks/raster'
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

test('the desktop drawing holds each ship class and stays within the Svg limit', async () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    ship(`a${i}`, { model: (['haiku', 'sonnet', 'opus', 'fable'] as const)[i % 4], effort: i % 5, variant: Math.floor(i / 4) % 2 }),
  )
  const svg = fleetSvg([...many, ship('w', { status: 'wait' })], 5000, true)
  expect(svg.source.length).toBeLessThan(131072)
  for (const key of ['haiku-0', 'haiku-1', 'sonnet-0', 'sonnet-1', 'opus-0', 'opus-1', 'admiral']) {
    expect(svg.source).toContain(`id="sp-${key}"`)
  }
  expect(svg.alt).toContain('13 Agenten')
  expect(svg.alt).toContain('1 warten auf Freigabe')
})

test('the terminal frame packs one cell triplet per column and row', async () => {
  const columns = 100
  const f = frame([ship('a'), ship('b', { model: 'opus' })], 5000, columns, true)
  expect(f.cells.length).toBe(Math.ceil((columns * ROWS * 12) / 3) * 4)
  expect(f.labels).toContain('HAUPTSITZUNG')
})

test('an Agent call followed by SubagentStart puts its ship in the band', async ($, on) => {
  mock.clock(on, { now: 10_000 })
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  await $.tool.call({
    tool: 'Agent', description: 'Epic 3 zerlegen', prompt: 'Plan it', subagent_type: 'Plan', model: 'opus', effort: 'high',
  })
  await $.classic.SubagentStart({ agent_id: 'ag1', agent_type: 'Plan' })

  const desktop = await $.ui.mount({ plugin: 'agentenflotte', surface: 'desktop', ...BAND })
  const svg = await desktop.find({ type: 'Svg' })
  expect(String(svg?.props.alt)).toContain('1 Agenten im Einsatz')
  expect(String(svg?.props.source)).toContain('Epic 3 zerlegen')
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'agentenflotte', surface: 'terminal', ...BAND })
  expect(await terminal.find({ type: 'Raster' })).toBeDefined()
  await terminal.unmount()

  await $.classic.SubagentStop({ agent_id: 'ag1', agent_type: 'Plan', agent_transcript_path: '', stop_hook_active: false })
  const after = await $.ui.mount({ plugin: 'agentenflotte', surface: 'desktop', ...BAND })
  expect(String((await after.find({ type: 'Svg' }))?.props.source)).toContain('class="exit"')
})
