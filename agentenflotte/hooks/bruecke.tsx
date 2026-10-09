// The bridge (P3): spinner verbs and TurnDuration, a station label on tool rows, the status
// line ($.ui.status) with stardate, warp, shields, fleet and alert, a mode label on alert,
// a note under permission dialogs, and a toast when a subagent returns. Only while
// isOn($, 'bruecke').

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Alert } from '../types'
import { ALERT_LABEL, COLOR, stardate, stationOf, warpOf } from './lexicon'
import { effortIndex } from './ships'
import { INITIAL, isOn, mirrored } from './state'

const settings = atom({ plugin: 'agentenflotte', key: 'settings' } as const, INITIAL.settings)
const alert = atom({ plugin: 'agentenflotte', key: 'alert' } as const, INITIAL.alert)
const fleet = atom({ plugin: 'agentenflotte', key: 'fleet' } as const, INITIAL.fleet)
const contextLeft = atom({ plugin: 'agentenflotte', key: 'contextLeft' } as const, INITIAL.contextLeft)
const verbSlot = atom({ plugin: 'agentenflotte', key: 'verbSlot' } as const, 0)

/** How often the status line refreshes, and how long a spinner verb stays. */
const STATUS_MS = 5000
const VERB_MS = 3000

type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

const VERBS: Record<SpinnerMode, readonly string[]> = {
  thinking: ['Subraumfeld modulieren', 'Sensordaten auswerten', 'Flugbahn berechnen'],
  requesting: ['Kurs berechnen', 'Frequenz öffnen', 'Verbindung herstellen'],
  responding: ['Logbuch diktieren', 'Bericht abfassen', 'Funkspruch absetzen'],
  'tool-input': ['Sensoren ausrichten', 'Koordinaten eingeben', 'Phaser fokussieren'],
  'tool-use': ['Warpkern kalibrieren', 'Plasmaleitungen prüfen', 'Antrieb abstimmen'],
}

const ALERT_VERBS: Record<Exclude<Alert, 'normal'>, readonly string[]> = {
  gelb: ['Autorisierung abwarten', 'Freigabe erbitten', 'Befehl abwarten'],
  rot: ['Schadensbericht anfordern', 'Hüllenschäden melden', 'Notfallprotokoll starten'],
  blau: ['Hilfsenergie umleiten', 'Reserven mobilisieren', 'Systeme sichern'],
}

type StationLabel = { label: string; color: string }

/** The station label of each tool row; tools not listed get none. */
const STATION: Record<string, StationLabel> = {}
const GROUPS: [string[], StationLabel][] = [
  [['Grep', 'Glob', 'WebSearch', 'WebFetch'], { label: 'Sensorscan', color: COLOR.almond }],
  [['Read'], { label: 'Archiv', color: COLOR.lilac }],
  [['Agent'], { label: 'Shuttlestart', color: COLOR.violet }],
  [['Edit', 'Write', 'NotebookEdit'], { label: 'Maschinenraum', color: COLOR.bluey }],
  [['Bash', 'PowerShell'], { label: 'Konsole', color: COLOR.butterscotch }],
  [['EnterWorktree', 'ExitWorktree'], { label: 'Transporter', color: COLOR.mauve }],
]
for (const [tools, station] of GROUPS) for (const tool of tools) STATION[tool] = station
const HULL_BREACH: StationLabel = { label: 'Hüllenbruch', color: COLOR.rot }

// The main session's effort as last seen on a classic event, the status line as last shown, and
// the call each pending question is about: a permission request carries no tool_use_id, but the
// check that precedes its dialog does, so that is where the call is noted, by who asks and what.
let mainEffort: number | null = null
let shown: string | undefined
const asking = new Map<string, string>()
const askKey = (agentId: string | undefined, tool: string) => `${agentId ?? ''}
${tool}`

/** One verb of a list, the same for the same moment and changing as time passes. */
function verbAt(list: readonly string[], now: number): string {
  return list[Math.floor(now / VERB_MS) % list.length] as string
}

/** The status line, or undefined while the bridge is off. */
async function statusText($: EngineInterface): Promise<string | undefined> {
  if (!isOn(await read($, settings), 'bruecke')) return undefined
  const ships = (await read($, fleet)).filter(s => s.status === 'run' || s.status === 'wait')
  const level = await read($, alert)
  const shields = await read($, contextLeft)
  const effort = mainEffort ?? (ships.length > 0 ? Math.max(...ships.map(s => s.effort)) : null)
  return [
    `SZ ${stardate(await $.clock.now())}`,
    effort !== null ? `Warp ${warpOf(effort)}` : null,
    shields !== null ? `Schilde ${shields} %` : null,
    `Flotte ${ships.length}`,
    level !== 'normal' ? ALERT_LABEL[level] : null,
  ]
    .filter(part => part !== null)
    .join(' · ')
}

// Only a changed line is set, so the ticker does not clear a line the bridge no longer holds.
async function refreshStatus($: EngineInterface) {
  const text = await statusText($)
  if (text === shown) return
  shown = text
  $.ui.status(text)
}

/** A duration the way the German line says it: `3 s`, `1 min 12 s`, `1 h 5 min`. */
function duration(ms: number): string {
  const total = Math.round(ms / 1000)
  const [h, m, sec] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`
  if (m > 0) return sec > 0 ? `${m} min ${sec} s` : `${m} min`
  return `${sec} s`
}

// The engine keeps a drawing until its props change or a state it read is written, and no spinner
// prop moves with time: the ticker writes the slot the clock is in, the Spinner hook reads it.
async function advanceVerb($: EngineInterface) {
  if (!isOn(await read($, settings), 'bruecke')) return
  const slot = Math.floor((await $.clock.now()) / VERB_MS)
  await update($, verbSlot, () => slot)
}

/** What the ship of an agent was sent to do, else its type. */
function describe(agentId: string | undefined, agentType: string): string {
  return mirrored().find(s => s.id === agentId)?.desc ?? agentType
}

export function registerBruecke(on: On) {
  on('session.start', {}, async ($, e, next) => {
    $.clock.every(STATUS_MS, () => void refreshStatus($))
    $.clock.every(VERB_MS, () => void advanceVerb($))
    await refreshStatus($)
    return next(e)
  })

  // The switches changing clears or restores the status line without waiting for the ticker.
  on('state.set', { plugin: 'agentenflotte', key: 'settings' }, async ($, e, next) => {
    const res = await next(e)
    await refreshStatus($)
    return res
  })

  // The fleet (fleet.ts has already written) and the context change what the line shows.
  on('classic.SubagentStart', {}, async ($, e, next) => {
    await refreshStatus($)
    return next(e)
  })
  on('session.measure', {}, async ($, e, next) => {
    await refreshStatus($)
    return next(e)
  })

  // The main session's effort is the bridge's warp factor.
  // A result or refusal also ends a subagent's yellow alert, which fleet.ts has already written.
  on('classic.PostToolUse', {}, async ($, e, next) => {
    if (!e.agent_id && e.effort) mainEffort = effortIndex(e.effort.level)
    await refreshStatus($)
    return next(e)
  })
  on('classic.PermissionDenied', {}, async ($, e, next) => {
    await refreshStatus($)
    return next(e)
  })
  on('classic.UserPromptSubmit', {}, async ($, e, next) => {
    if (!e.agent_id && e.effort) mainEffort = effortIndex(e.effort.level)
    return next(e)
  })

  // A question for the person is noted with its call, for the permission request that follows.
  on('tool.check', {}, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id) asking.set(askKey(e.agentId, e.tool), e.tool_use_id)
    return verdict
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!isOn(await read($, settings), 'bruecke')) return next(e)
    // The desktop word names the step at hand (`Creating notes.md`); only its idle `Working` gives way.
    if (e.surface !== 'terminal' && e.props.word !== 'Working') return next(e)
    await read($, verbSlot)
    const level = await read($, alert)
    const list = level === 'normal' ? VERBS[e.props.mode] : ALERT_VERBS[level]
    return next({ ...e, props: { ...e.props, word: verbAt(list, await $.clock.now()) } })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!isOn(await read($, settings), 'bruecke')) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{`Unter Warp · ${duration(e.props.durationMs)}`}</Text>
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!isOn(await read($, settings), 'bruecke')) return next(e)
    const station = e.props.isErrored ? HULL_BREACH : STATION[e.props.tool]
    if (!station) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text color={station.color} bold>
          {station.label}{' '}
        </Text>
        {await next(e)}
      </Box>
    )
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!isOn(await read($, settings), 'bruecke')) return next(e)
    const level = await read($, alert)
    if (level === 'normal') return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, ALERT_LABEL[level]] } })
  })

  // A permission dialog is yellow alert: say who asks, in a line under the dialog.
  on('classic.PermissionRequest', {}, async ($, e, next) => {
    await refreshStatus($)
    const key = askKey(e.agent_id, e.tool_name)
    const id = asking.get(key)
    asking.delete(key)
    if (id && isOn(await read($, settings), 'bruecke')) {
      const station = e.agent_id ? stationOf(e.agent_type ?? '') : 'Brücke'
      try {
        $.ui.notice(id, `▲ Alarmstufe Gelb · ${station} erbittet Autorisierung`)
      } catch {
        // The call is no longer open: there is no dialog to annotate.
      }
    }
    return next(e)
  })

  on('classic.SubagentStop', {}, async ($, e, next) => {
    await refreshStatus($)
    if (isOn(await read($, settings), 'bruecke')) {
      $.ui.toast(`Eingehender Ruf · ${describe(e.agent_id, e.agent_type)}: zurück an Bord`)
    }
    return next(e)
  })

  on('classic.StopFailure', {}, async ($, e, next) => {
    await refreshStatus($)
    if (e.agent_id && isOn(await read($, settings), 'bruecke')) {
      $.ui.toast(`Hüllenbruch · ${describe(e.agent_id, e.agent_type ?? 'Agent')}`)
    }
    return next(e)
  })
}
