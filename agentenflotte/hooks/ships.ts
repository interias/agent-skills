// The ships' vocabulary: model classes, effort and warp, how long ships linger, and the
// small formatting helpers the bridge, the log and the tactical display share.

export type ModelKey = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type HullKey = ModelKey | 'admiral'

export const MODEL_LABEL: Record<HullKey, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  fable: 'Fable',
  admiral: 'Hauptsitzung',
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const WARP = ['2', '4', '6', '8', '9,9']

/** How long a finished ship stays in the fleet, and a failed one. */
export const EXIT_MS = 1400
export const FAIL_LINGER_MS = 8000

/** Stable variant per agent, so a ship keeps its look across redraws. */
export function variantOf(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h) % 2
}

export function effortIndex(level: string | null | undefined): number {
  const i = (EFFORTS as readonly string[]).indexOf(level ?? '')
  return i < 0 ? 1 : i
}

export function modelOf(name: string | null | undefined): ModelKey {
  const n = (name ?? '').toLowerCase()
  for (const m of ['haiku', 'sonnet', 'opus', 'fable'] as const) if (n.includes(m)) return m
  return 'sonnet'
}

/** Entry i of a fixed table, i clamped into range. */
export function at<T>(list: readonly T[], i: number): T {
  return list[Math.max(0, Math.min(list.length - 1, i))] as T
}

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}
