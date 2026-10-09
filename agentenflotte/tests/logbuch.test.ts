import { expect, mock, test } from 'claude-code/testing'

import { COMPUTER_SECTION } from '../hooks/computer'
import { stardate } from '../hooks/lexicon'

const NOW = Date.UTC(2026, 9, 9)

const cmd = (command: string, args = '') =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

const TURN = { answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const

async function setup($: any, on: any, stored: Record<string, unknown> = {}, written: any[] = []) {
  mock.clock(on, { now: NOW })
  // Before mock.store, which answers without next: records what the log writes.
  on('store.set', { key: 'logbuch' }, (_$: any, e: any, next: any) => (written.push(e.value), next(e)))
  mock.store(on, stored)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('classic.StopFailure', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const launch = async ($: any, id: string) => {
  await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y', subagent_type: 'Plan', model: 'opus' })
  await $.classic.SubagentStart({ agent_id: id, agent_type: 'Plan' })
}
const back = (id: string) => ({ agent_id: id, agent_type: 'Plan', agent_transcript_path: '', stop_hook_active: false })
const ask = (id: string) => ({ agent_id: id, agent_type: 'Plan', tool_name: 'Bash', tool_input: {} }) as never

test('a turn with mixed events yields one log line with correct plurals', async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await launch($, 'a1')
  await launch($, 'a2')
  await $.classic.SubagentStop(back('a1'))
  await $.classic.PermissionRequest(ask('a2'))
  const r = await $.turn.complete(TURN)
  expect(r.text).toBe(`Logbuch, Sternzeit ${stardate(NOW)}: 2 Shuttles gestartet, 1 zurück an Bord, 1 wartet auf Autorisierung.`)
})

test('a failure and two waits use the plural, parts at zero are left out', async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.classic.StopFailure({ error: 'server_error', agent_id: 'a1' } as never)
  await $.classic.PermissionRequest(ask('a1'))
  await $.classic.PermissionRequest(ask('a2'))
  const r = await $.turn.complete(TURN)
  expect(r.text).toBe(`Logbuch, Sternzeit ${stardate(NOW)}: 1 ausgefallen, 2 warten auf Autorisierung.`)
})

test('no line without events, none for a subagent turn, and turn.start resets the count', async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect((await $.turn.complete(TURN)).text).toBe('ok')

  await launch($, 'a1')
  expect((await $.turn.complete({ ...TURN, agentId: 'a1' })).text).toBe('ok')
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect((await $.turn.complete(TURN)).text).toBe('ok')
  expect((await $.command.run(cmd('logbuch'))).text).toBe('Noch keine Einträge im Logbuch.')
})

test('entries are stored and capped at 200, oldest dropped', async ($, on) => {
  const old = Array.from({ length: 200 }, (_, i) => ({ stardate: '1.0', at: i, text: `alt ${i}` }))
  const written: { text: string }[][] = []
  await setup($, on, { logbuch: old }, written)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await launch($, 'a1')
  const r = await $.turn.complete(TURN)
  const shown = ((await $.command.run(cmd('logbuch', 'alle'))).text as string).split('\n')
  expect(shown[0]).toBe(r.text)
  expect(shown[1]).toBe('alt 199')
  const kept = written.at(-1) ?? []
  expect(kept.length).toBe(200)
  expect(kept[0]?.text).toBe('alt 1')
  expect(kept[199]?.text).toBe(r.text)
})

test('a subagent turn neither writes a line nor resets the count of the main turn', async ($, on) => {
  const written: unknown[] = []
  await setup($, on, {}, written)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await launch($, 'a1')
  expect((await $.turn.complete({ ...TURN, turnId: 'sub', agentId: 'a1' })).text).toBe('ok')
  await $.classic.SubagentStop(back('a1'))
  const r = await $.turn.complete(TURN)
  expect(r.text).toBe(`Logbuch, Sternzeit ${stardate(NOW)}: 1 Shuttle gestartet, 1 zurück an Bord.`)
  expect(written).toEqual([[{ stardate: stardate(NOW), at: NOW, text: r.text }]])
})

test('/logbuch shows ten newest first, /logbuch alle up to 50, and the empty case', async ($, on) => {
  const many = Array.from({ length: 60 }, (_, i) => ({ stardate: '1.0', at: i, text: `e${i}` }))
  await setup($, on, { logbuch: many })
  const lines = async (args = '') => ((await $.command.run(cmd('logbuch', args))).text as string).split('\n')
  expect(await lines()).toEqual(['e59', 'e58', 'e57', 'e56', 'e55', 'e54', 'e53', 'e52', 'e51', 'e50'])
  const all = await lines('alle')
  expect(all.length).toBe(50)
  expect(all[49]).toBe('e10')
})

test('/logbuch with no entries says so', async ($, on) => {
  await setup($, on)
  expect((await $.command.run(cmd('logbuch'))).text).toBe('Noch keine Einträge im Logbuch.')
})

test('/flotte logbuch aus stops the line, /logbuch still answers and says how to switch on', async ($, on) => {
  await setup($, on, { logbuch: [{ stardate: '1.0', at: 1, text: 'e1' }] })
  await $.command.run(cmd('flotte', 'logbuch aus'))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await launch($, 'a1')
  expect((await $.turn.complete(TURN)).text).toBe('ok')
  expect((await $.command.run(cmd('logbuch'))).text).toBe('e1\nDas Logbuch ist aus. Einschalten mit /flotte logbuch an.')

  await $.command.run(cmd('flotte', 'logbuch an'))
  await $.turn.start({ text: 'go', turnId: 't2' })
  await launch($, 'a2')
  expect((await $.turn.complete({ ...TURN, turnId: 't2' })).text).toContain('1 Shuttle gestartet.')
})

test('the computer persona is added at the end only while switched on', async ($, on) => {
  mock.store(on)
  const base = [{ id: 'engine:x', text: 'x', scope: 'shared' }] as const
  on('prompt.compose', () => ({ sections: base }))
  const compose = () => $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [],
  })

  expect((await compose()).sections).toEqual(base)
  await $.command.run(cmd('flotte', 'computer an'))
  const withPersona = (await compose()).sections
  expect(withPersona).toEqual([...base, COMPUTER_SECTION])
  expect(withPersona[1]?.id).toBe('agentenflotte:computer')
  await $.command.run(cmd('flotte', 'computer aus'))
  expect((await compose()).sections).toEqual(base)
  await $.command.run(cmd('flotte', 'computer an'))
  await $.command.run(cmd('flotte'))
  expect((await compose()).sections).toEqual(base)
})
