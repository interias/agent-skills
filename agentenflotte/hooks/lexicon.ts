// The bridge's vocabulary: stardate, warp factor, stations, alert names and the palette.

import type { Alert } from '../types'
import { WARP, at } from './ships'

export type Station = 'Wissenschaft' | 'Maschinenraum' | 'Taktik' | 'Navigation' | 'Brücke'

export const COLOR = {
  orange: '#eb943a',
  butterscotch: '#ea9c72',
  almond: '#fcc19f',
  violet: '#baa4e5',
  lilac: '#8a72a7',
  bluey: '#8899ff',
  mauve: '#c082a9',
  gelb: '#ffcc33',
  rot: '#ff3300',
  blau: '#2288ff',
  black: '#000000',
  space: '#05071a',
} as const

export const ALERT_COLOR: Record<Alert, string> = {
  normal: COLOR.orange,
  gelb: COLOR.gelb,
  rot: COLOR.rot,
  blau: COLOR.blau,
}

export const ALERT_LABEL: Record<Alert, string> = {
  normal: 'Normalbetrieb',
  gelb: 'Alarmstufe Gelb',
  rot: 'Alarmstufe Rot',
  blau: 'Alarmstufe Blau',
}

/** 41000 at the start of 1987, a thousand per year, to one decimal, in UTC. */
export function stardate(nowMs: number): string {
  const year = new Date(nowMs).getUTCFullYear()
  const start = Date.UTC(year, 0, 1)
  const share = (nowMs - start) / (Date.UTC(year + 1, 0, 1) - start)
  const value = 41000 + 1000 * (year - 1987) + 1000 * share
  return value.toFixed(1)
}

/** The warp factor of an effort index (low … max), from the WARP table in ships.ts. */
export function warpOf(effortIndex: number): string {
  return at(WARP, effortIndex)
}

/** The bridge station an agent type serves at. */
export function stationOf(agentType: string): Station {
  const t = agentType.toLowerCase()
  if (t.includes('explore') || t.includes('kundschafter')) return 'Wissenschaft'
  if (t.includes('implementer')) return 'Maschinenraum'
  if (t.includes('reviewer')) return 'Taktik'
  if (/(^|[^a-z])plan/.test(t) || t.includes('epic-lauf')) return 'Navigation'
  return 'Brücke'
}
