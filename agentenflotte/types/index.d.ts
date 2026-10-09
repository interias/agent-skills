export type ShipStatus = 'run' | 'wait' | 'done' | 'fail'

export type Ship = {
  id: string
  agentType: string
  desc: string
  model: 'haiku' | 'sonnet' | 'opus' | 'fable'
  /** Index into low, medium, high, xhigh, max. */
  effort: number
  variant: number
  status: ShipStatus
  startedAt: number
  endedAt: number | null
}

/** An Agent tool call seen before its SubagentStart, waiting to be matched. */
export type Launch = {
  agentType: string
  desc: string
  model: string | null
  effort: string | null
}

declare module 'claude-code' {
  interface PluginState {
    agentenflotte: { fleet: Ship[]; pending: Launch[]; isHidden: boolean }
  }
}
