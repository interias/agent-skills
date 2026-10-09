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

/** The mod's switches: `all` is the main switch `/flotte` toggles, the rest one part each. */
export type FleetSettings = { all: boolean; bruecke: boolean; logbuch: boolean; computer: boolean }

export type Alert = 'normal' | 'gelb' | 'rot' | 'blau'

declare module 'claude-code' {
  interface PluginState {
    agentenflotte: {
      fleet: Ship[]
      pending: Launch[]
      settings: FleetSettings
      /** When the main session last hit a StopFailure, in ms since the epoch. */
      mainFailAt: number | null
      /** Context window left, in whole percent; null before the first measurement. */
      contextLeft: number | null
      isCompacting: boolean
      /** The bridge's alert, kept by fleet.ts from the values above. */
      alert: Alert

      // P3: bruecke
      /** The spinner verb period the clock is in, kept by bruecke.tsx so a spinner redraws as the verb moves. */
      verbSlot: number

      // P5: taktik
      /** Beats of the tactical display's ticker; the open pane reads it to draw again. */
      taktikTick: number
    }
  }
}
