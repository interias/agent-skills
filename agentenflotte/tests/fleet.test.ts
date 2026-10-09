import { expect, mock, test } from 'claude-code/testing'

import type { Ship } from '../types'

test('an Agent call followed by SubagentStart puts its ship in the fleet, SubagentStop brings it home', async ($, on) => {
  mock.clock(on, { now: 10_000 })
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('tool.call', () => ({ result: { status: 'async_launched' }, text: 'launched' }) as never)
  let fleet: Ship[] = []
  on('state.set', { plugin: 'agentenflotte', key: 'fleet' }, ($, e, next) => {
    fleet = e.value as Ship[]
    return next(e)
  })

  await $.tool.call({
    tool: 'Agent', description: 'Epic 3 zerlegen', prompt: 'Plan it', subagent_type: 'Plan', model: 'opus', effort: 'high',
  })
  await $.classic.SubagentStart({ agent_id: 'ag1', agent_type: 'Plan' })
  expect(fleet).toHaveLength(1)
  expect(fleet[0]).toMatchObject({ id: 'ag1', desc: 'Epic 3 zerlegen', model: 'opus', effort: 2, status: 'run' })

  await $.classic.SubagentStop({ agent_id: 'ag1', agent_type: 'Plan', agent_transcript_path: '', stop_hook_active: false })
  expect(fleet[0]?.status).toBe('done')
})
