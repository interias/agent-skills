import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Launch, Ship } from '../types'
import { ROWS, frame } from './raster'
import { EXIT_MS, FAIL_LINGER_MS, effortIndex, modelOf, variantOf } from './sprites'
import { fleetSvg } from './svg'

const fleet = atom({ plugin: 'agentenflotte', key: 'fleet' } as const, [] as Ship[])
const pending = atom({ plugin: 'agentenflotte', key: 'pending' } as const, [] as Launch[])
const isHidden = atom({ plugin: 'agentenflotte', key: 'isHidden' } as const, false)

// What the terminal ticker repaints: the fleet as last written and the mounted band.
let mirror: Ship[] = []
let site: { requestId: string; columns: number; isWorking: boolean } | null = null

async function write($: EngineInterface, fn: (list: Ship[]) => Ship[]) {
  await update($, fleet, list => fn(list ?? []))
  mirror = await read($, fleet)
}

async function setStatus($: EngineInterface, id: string, status: Ship['status'], endedAt: number | null) {
  await write($, list =>
    list.map(s => (s.id === id && s.status !== 'done' ? { ...s, status, endedAt: endedAt ?? s.endedAt } : s)),
  )
}

function removeLater($: EngineInterface, id: string, ms: number) {
  $.clock.after(ms, () => void write($, list => list.filter(s => s.id !== id)))
}

// A tool result or refusal from a subagent clears its yellow alert and reports its real effort.
async function resume($: EngineInterface, id: string | undefined, level: string | undefined) {
  const ship = id ? mirror.find(s => s.id === id) : undefined
  if (!ship) return
  const effort = level ? effortIndex(level) : ship.effort
  if (ship.status === 'wait' || effort !== ship.effort) {
    await write($, list =>
      list.map(s => (s.id === ship.id ? { ...s, status: s.status === 'wait' ? 'run' : s.status, effort } : s)),
    )
  }
}

async function paintTerminal($: EngineInterface) {
  if (!site) return
  const now = await $.clock.now()
  const f = frame(mirror, now, site.columns, site.isWorking)
  const res = await $.ui.blit({ requestId: site.requestId, key: 'convoy', cells: f.cells, columns: site.columns, rows: ROWS })
  if (res.deny !== undefined) site = null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    mirror = await read($, fleet)
    await $.command.register({ name: 'flotte', description: 'Agentenflotte über der Eingabezeile ein- oder ausblenden' })
    $.clock.every(120, () => void paintTerminal($))
    return next(e)
  })

  on('command.run', { command: 'flotte' }, async $ => {
    await update($, isHidden, hidden => !hidden)
    return { text: (await read($, isHidden)) ? 'Agentenflotte ausgeblendet.' : 'Agentenflotte eingeblendet.' }
  })

  // The Agent call carries what SubagentStart lacks: description, model and effort.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const launch: Launch = {
      agentType: e.subagent_type ?? 'general-purpose',
      desc: e.description,
      model: e.model ?? null,
      effort: e.effort ?? null,
    }
    await update($, pending, list => [...(list ?? []), launch].slice(-20))
    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    const list = await read($, pending)
    const idx = Math.max(0, list.findIndex(l => l.agentType === e.agent_type))
    const launch = list[idx] as Launch | undefined
    if (launch) await update($, pending, l => (l ?? []).filter((_, i) => i !== idx))
    const ship: Ship = {
      id: e.agent_id,
      agentType: e.agent_type,
      desc: launch?.desc ?? e.agent_type,
      model: modelOf(launch?.model ?? (await $.session.model())),
      effort: effortIndex(launch?.effort ?? e.effort?.level),
      variant: variantOf(e.agent_id),
      status: 'run',
      startedAt: await $.clock.now(),
      endedAt: null,
    }
    await write($, l => [...l.filter(s => s.id !== ship.id), ship])
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await setStatus($, e.agent_id, 'done', await $.clock.now())
    removeLater($, e.agent_id, EXIT_MS + 200)
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    if (e.agent_id) {
      await setStatus($, e.agent_id, 'fail', await $.clock.now())
      removeLater($, e.agent_id, FAIL_LINGER_MS)
    }
    return next(e)
  })

  // A subagent asking for permission is on yellow alert until its tool runs or is refused.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id) await setStatus($, e.agent_id, 'wait', null)
    return next(e)
  })
  on('classic.PostToolUse', async ($, e, next) => {
    await resume($, e.agent_id, e.effort?.level)
    return next(e)
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    await resume($, e.agent_id, e.effort?.level)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ships = await read($, fleet)
    mirror = ships
    if (e.props.hasSurvey || (await read($, isHidden))) {
      site = null
      return next(e)
    }
    const now = await $.clock.now()

    if (e.surface === 'terminal') {
      const { Box, Raster, Text } = $.ui.resolve(e)
      const columns = Math.max(20, Math.min(512, e.props.bodyColumns))
      site = { requestId: e.requestId, columns, isWorking: e.props.isWorking }
      const f = frame(ships, now, columns, e.props.isWorking)
      return (
        <Box flexDirection="column">
          <Raster key="convoy" columns={columns} rows={ROWS} cells={f.cells} />
          <Text dimColor>{f.labels}</Text>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const svg = fleetSvg(ships, now, e.props.isWorking)
    return <Svg source={svg.source} alt={svg.alt} isInteractive />
  })
}
