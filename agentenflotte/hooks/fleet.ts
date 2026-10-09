// The fleet's events: subagents launch, wait, fail and return; the main session's failures,
// context fill and compaction feed the bridge's alert. Every feature reads what this writes.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Alert, Launch, Ship } from '../types'
import { EXIT_MS, FAIL_LINGER_MS, effortIndex, modelOf, variantOf } from './sprites'
import { INITIAL, MAIN_FAIL_MS, alertOf, mirrored, setMirror } from './state'

const fleet = atom({ plugin: 'agentenflotte', key: 'fleet' } as const, INITIAL.fleet)
const pending = atom({ plugin: 'agentenflotte', key: 'pending' } as const, INITIAL.pending)
const mainFailAt = atom({ plugin: 'agentenflotte', key: 'mainFailAt' } as const, INITIAL.mainFailAt)
const contextLeft = atom({ plugin: 'agentenflotte', key: 'contextLeft' } as const, INITIAL.contextLeft)
const isCompacting = atom({ plugin: 'agentenflotte', key: 'isCompacting' } as const, INITIAL.isCompacting)
const alert = atom({ plugin: 'agentenflotte', key: 'alert' } as const, INITIAL.alert)

/** The alert its inputs call for right now. */
async function readAlert($: EngineInterface): Promise<Alert> {
  return alertOf({
    fleet: await read($, fleet),
    now: await $.clock.now(),
    mainFailAt: await read($, mainFailAt),
    contextLeft: await read($, contextLeft),
    isCompacting: await read($, isCompacting),
  })
}

// Kept as a value of its own, so a drawing that shows the alert redraws when it changes.
async function refreshAlert($: EngineInterface) {
  const level = await readAlert($)
  if (level !== (await read($, alert))) await update($, alert, () => level)
}

async function write($: EngineInterface, fn: (list: Ship[]) => Ship[]) {
  await update($, fleet, list => fn(list ?? []))
  setMirror(await read($, fleet))
  await refreshAlert($)
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
  const ship = id ? mirrored().find(s => s.id === id) : undefined
  if (!ship) return
  const effort = level ? effortIndex(level) : ship.effort
  if (ship.status === 'wait' || effort !== ship.effort) {
    await write($, list =>
      list.map(s => (s.id === ship.id ? { ...s, status: s.status === 'wait' ? 'run' : s.status, effort } : s)),
    )
  }
}

async function clearMainFail($: EngineInterface, at: number) {
  await update($, mainFailAt, cur => (cur === at ? null : (cur ?? null)))
  await refreshAlert($)
}

export function registerFleet(on: On) {
  on('session.start', {}, async ($, e, next) => {
    setMirror(await read($, fleet))
    return next(e)
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

  // A subagent's failure turns its ship red; the main session's holds the bridge on red alert a while.
  on('classic.StopFailure', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agent_id) {
      await setStatus($, e.agent_id, 'fail', now)
      removeLater($, e.agent_id, FAIL_LINGER_MS)
    } else {
      await update($, mainFailAt, () => now)
      await refreshAlert($)
      $.clock.after(MAIN_FAIL_MS, () => void clearMainFail($, now))
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

  on('session.measure', async ($, e, next) => {
    const used = e.context.percent
    if (e.changed.includes('context') && used !== undefined) {
      await update($, contextLeft, () => Math.max(0, 100 - used))
      await refreshAlert($)
    }
    return next(e)
  })

  // The main conversation compacting (not a subagent's, not a precompute) is blue alert until it ends.
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute' || e.agentId) return next(e)
    await update($, isCompacting, () => true)
    await refreshAlert($)
    try {
      return await next(e)
    } finally {
      await update($, isCompacting, () => false)
      await refreshAlert($)
    }
  })
}
