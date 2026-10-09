import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const run = (args = '') =>
  ({ command: 'flotte', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

// The engine's own answer for a component, standing in below the bridge: its text is what the props say.
const engineLine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const p = e.props as Record<string, unknown>
    return h(Text, { key: 'engine' }, String(p.word ?? p.tool ?? p.modes ?? '')) as never
  })

const start = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.session.start({ cwd: '/', surface, isInteractive: true })

const baseAnswers = (on: On) => {
  on('classic.*', () => ({}) as never)
  on('session.measure', (_$, e) => e as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

const spinnerWord = async ($: Engine, mode: string, surface: 'terminal' | 'desktop' = 'terminal', word = surface === 'desktop' ? 'Working' : 'Sauteing') => {
  const ui = await $.ui.mount({
    plugin: 'agentenflotte', surface, component: 'Spinner', requestId: 's',
    props: { word, message: null, suffix: '…', mode },
  } as never)
  const text = (await ui.findAll({ type: 'Text' }))[0]?.text
  await ui.unmount()
  return text
}

const toolLine = async ($: Engine, surface: 'terminal' | 'desktop', tool: string, isErrored = false) => {
  const ui = await $.ui.mount({
    plugin: 'agentenflotte', surface, component: 'ToolUse', requestId: 't',
    props: { tool_use_id: 't', tool, input: {}, isRunning: false, isErrored, isInterrupted: false },
  } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return texts
}

async function $launch($: Engine, id: string, agentType: string, desc = 'Spawn-Logik suchen') {
  await $.tool.call({ tool: 'Agent', description: desc, prompt: 'x', subagent_type: agentType, model: 'haiku', effort: 'high' } as never)
  await $.classic.SubagentStart({ agent_id: id, agent_type: agentType })
}

test('the spinner word follows the mode, changes with time and follows the alert', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on)
  baseAnswers(on)
  engineLine(on)
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)

  expect(await spinnerWord($, 'thinking')).toBe('Subraumfeld modulieren')
  expect(await spinnerWord($, 'requesting')).toBe('Kurs berechnen')
  expect(await spinnerWord($, 'responding')).toBe('Logbuch diktieren')
  expect(await spinnerWord($, 'tool-input')).toBe('Sensoren ausrichten')
  expect(await spinnerWord($, 'tool-use')).toBe('Warpkern kalibrieren')
  await clock.advance(3000)
  expect(await spinnerWord($, 'thinking')).toBe('Sensordaten auswerten')
  // The desktop row takes the verb while idle, and keeps the step it names.
  expect(await spinnerWord($, 'thinking', 'desktop')).toBe('Sensordaten auswerten')
  expect(await spinnerWord($, 'tool-use', 'desktop')).toBe('Plasmaleitungen prüfen')
  expect(await spinnerWord($, 'tool-use', 'desktop', 'Creating notes.md')).toBe('Creating notes.md')

  // Yellow: a subagent waits for permission.
  await $launch($, 'a1', 'Explore')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'a1', agent_type: 'Explore' } as never)
  expect(['Autorisierung abwarten', 'Freigabe erbitten', 'Befehl abwarten']).toContain(await spinnerWord($, 'thinking'))
  // Red: it fails.
  await $.classic.StopFailure({ agent_id: 'a1', agent_type: 'Explore', error: 'server_error' } as never)
  expect(['Schadensbericht anfordern', 'Hüllenschäden melden', 'Notfallprotokoll starten']).toContain(await spinnerWord($, 'tool-use'))
  expect(['Schadensbericht anfordern', 'Hüllenschäden melden', 'Notfallprotokoll starten']).toContain(await spinnerWord($, 'tool-use', 'desktop'))
})

test('a spinner on screen redraws to the next verb as time passes', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on)
  baseAnswers(on)
  engineLine(on)
  on('ui.status', () => ({ value: undefined }) as never)
  await start($)
  const ui = await $.ui.mount({
    plugin: 'agentenflotte', surface: 'terminal', component: 'Spinner', requestId: 's',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
  } as never)
  expect((await ui.findAll({ type: 'Text' }))[0]?.text).toBe('Subraumfeld modulieren')
  await clock.advance(3000)
  expect((await ui.findAll({ type: 'Text' }))[0]?.text).toBe('Sensordaten auswerten')
  await clock.advance(3000)
  expect((await ui.findAll({ type: 'Text' }))[0]?.text).toBe('Flugbahn berechnen')
  await ui.unmount()
})

test('the turn duration line says Unter Warp and the duration in German', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on)
  baseAnswers(on)
  engineLine(on)
  const line = async (durationMs: number) => {
    const ui = await $.ui.mount({
      plugin: 'agentenflotte', surface: 'terminal', component: 'TurnDuration', requestId: 'd',
      props: { word: 'Baked', durationMs },
    } as never)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    await ui.unmount()
    return texts
  }
  expect(await line(3000)).toEqual(['Unter Warp · 3 s'])
  expect(await line(72_000)).toEqual(['Unter Warp · 1 min 12 s'])
  expect(await line(120_000)).toEqual(['Unter Warp · 2 min'])
  expect(await line(3_900_000)).toEqual(['Unter Warp · 1 h 5 min'])

  // Off, the engine's own line stands.
  await $.command.run(run('bruecke aus'))
  expect(await line(3000)).toEqual(['Baked'])
})

test('a tool row carries its station label on the terminal and the desktop', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on)
  baseAnswers(on)
  engineLine(on)
  const expected: [string, string][] = [
    ['Grep', 'Sensorscan'], ['Glob', 'Sensorscan'], ['WebSearch', 'Sensorscan'], ['WebFetch', 'Sensorscan'],
    ['Read', 'Archiv'], ['Agent', 'Shuttlestart'],
    ['Edit', 'Maschinenraum'], ['Write', 'Maschinenraum'], ['NotebookEdit', 'Maschinenraum'],
    ['Bash', 'Konsole'], ['PowerShell', 'Konsole'],
    ['EnterWorktree', 'Transporter'], ['ExitWorktree', 'Transporter'],
  ]
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [tool, label] of expected) {
      const texts = await toolLine($, surface, tool)
      expect(texts[0]?.trim()).toBe(label)
      expect(texts).toContain(tool)
    }
    // A failed call is a hull breach, whatever the tool.
    expect((await toolLine($, surface, 'Read', true))[0]?.trim()).toBe('Hüllenbruch')
    // Other tools stay as the engine draws them.
    expect(await toolLine($, surface, 'TodoWrite')).toEqual(['TodoWrite'])
  }
})

test('the status line shows stardate, warp, shields, fleet and alert, and drops what has no value', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(1987, 0, 1) })
  mock.store(on)
  baseAnswers(on)
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  const lines: (string | undefined)[] = []
  on('ui.status', (_$, e) => { lines.push(e.text as never); return { value: undefined } as never })
  await start($)
  expect(lines.at(-1)).toBe('SZ 41000.0 · Flotte 0')

  // The main session's effort is the warp factor; the measure gives the shields.
  await $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 'x', effort: { level: 'xhigh' } } as never)
  await $launch($, 'a1', 'Explore')
  expect(lines.at(-1)).toBe('SZ 41000.0 · Warp 8 · Flotte 1')
  await $.session.measure({ changed: ['context'], context: { percent: 70 } } as never)
  expect(lines.at(-1)).toBe('SZ 41000.0 · Warp 8 · Schilde 30 % · Flotte 1')

  // Yellow alert joins the line.
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'a1', agent_type: 'Explore' } as never)
  expect(lines.at(-1)).toBe('SZ 41000.0 · Warp 8 · Schilde 30 % · Flotte 1 · Alarmstufe Gelb')

  // The subagent's tool runs: its alert ends and the line follows at once.
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'y', agent_id: 'a1', agent_type: 'Explore' } as never)
  expect(lines.at(-1)).toBe('SZ 41000.0 · Warp 8 · Schilde 30 % · Flotte 1')

  // The ticker keeps the stardate current.
  await clock.advance(5000)
  expect(lines.at(-1)).toContain('Flotte 1')
})

test('the bridge switched off clears the status line and every other part', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on)
  baseAnswers(on)
  engineLine(on)
  const lines: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', (_$, e) => { lines.push(e.text as never); return { value: undefined } as never })
  on('ui.toast', (_$, e) => { toasts.push(e.text as never); return { value: undefined } as never })
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  await start($)
  expect(lines.at(-1)).toBeDefined()

  await $.command.run(run('bruecke aus'))
  expect(lines.at(-1)).toBeUndefined()
  // The ticker leaves the cleared line alone.
  const cleared = lines.length
  await clock.advance(10_000)
  expect(lines.length).toBe(cleared)
  expect(await spinnerWord($, 'thinking')).toBe('Sauteing')
  expect(await toolLine($, 'terminal', 'Read')).toEqual(['Read'])

  await $launch($, 'a1', 'Explore')
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: '', stop_hook_active: false })
  expect(toasts).toEqual([])
  expect(lines.at(-1)).toBeUndefined()

  await $.command.run(run('bruecke an'))
  expect(lines.at(-1)).toContain('SZ ')
  await $.command.run(run())
  expect(lines.at(-1)).toBeUndefined()
})

test('the mode footer gains the alert label off normal operation', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on)
  baseAnswers(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, ((e.props as { modes: string[] }).modes ?? []).join(' & ')) as never
  })
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  const modes = async () => {
    const ui = await $.ui.mount({ plugin: 'agentenflotte', surface: 'terminal', component: 'SessionMode', requestId: 'm', props: { modes: ['focus'] } } as never)
    const text = (await ui.findAll({ type: 'Text' }))[0]?.text
    await ui.unmount()
    return text
  }
  expect(await modes()).toBe('focus')
  await $launch($, 'a1', 'Explore')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'a1', agent_type: 'Explore' } as never)
  expect(await modes()).toBe('focus & Alarmstufe Gelb')
})

test('a permission request puts the station under its dialog', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on)
  baseAnswers(on)
  const notices: { id: string; text: string | undefined }[] = []
  on('ui.notice', (_$, e) => { notices.push({ id: e.tool_use_id, text: e.text } as never); return { value: undefined } as never })
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  // The engine's verdict: Bash and Edit ask, anything else may run.
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Bash' || e.tool === 'Edit' ? 'ask' : 'allow' }))
  const check = (tool: string, tool_use_id: string, agentId?: string) =>
    $.tool.check({ tool, input: {}, tool_use_id, ...(agentId ? { agentId } : {}) } as never)

  await check('Bash', 'tu1')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never)
  expect(notices.at(-1)).toEqual({ id: 'tu1', text: '▲ Alarmstufe Gelb · Brücke erbittet Autorisierung' })

  // Two Bash calls ask, the second after a call that was allowed: each dialog is its own call's.
  await check('Bash', 'tu2')
  await check('Read', 'tu3')
  await check('Bash', 'tu4')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as never)
  expect(notices.at(-1)?.id).toBe('tu4')

  await $launch($, 'r1', 'epic-reviewer-standard')
  await check('Edit', 'tu5', 'r1')
  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: {}, agent_id: 'r1', agent_type: 'epic-reviewer-standard' } as never)
  expect(notices.at(-1)).toEqual({ id: 'tu5', text: '▲ Alarmstufe Gelb · Taktik erbittet Autorisierung' })

  // A request whose call was never put as a question has no line to put.
  const before = notices.length
  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: {} } as never)
  expect(notices.length).toBe(before)

  // The bridge off, no line.
  await $.command.run(run('bruecke aus'))
  await check('Bash', 'tu6')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as never)
  expect(notices.length).toBe(before)
})

test('a returning subagent calls in, a failing one reports a hull breach', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on)
  baseAnswers(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text as never); return { value: undefined } as never })
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)

  await $launch($, 'a1', 'Explore', 'Spawn-Logik suchen')
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: '', stop_hook_active: false })
  expect(toasts.at(-1)).toBe('Eingehender Ruf · Spawn-Logik suchen: zurück an Bord')

  await $launch($, 'a2', 'Plan', 'Epic 3 zerlegen')
  await $.classic.StopFailure({ agent_id: 'a2', agent_type: 'Plan', error: 'server_error' } as never)
  expect(toasts.at(-1)).toBe('Hüllenbruch · Epic 3 zerlegen')

  // The main session's failure is not a subagent's.
  const before = toasts.length
  await $.classic.StopFailure({ error: 'server_error' } as never)
  expect(toasts.length).toBe(before)
})
