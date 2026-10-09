// Pixel sprites and the visual vocabulary shared by the desktop and terminal drawings.
// Side view, bow to the right. l light hull, h hull, d shadow, s class stripe,
// w windows, n warp nacelle grille, b bussard collector, e impulse engine, g deflector dish.

export type ModelKey = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type HullKey = ModelKey | 'admiral'

const RAW: Record<string, string[]> = {
  'haiku-0': [
    '.....llllllll',
    '...lhhhwwhwwhhl',
    '.eehhssssssssshh',
    '...dhhhhhhhhhhhd',
    '..nnnnnnnnnnnbb',
    '...ddddddddddd',
  ],
  'haiku-1': [
    '.......lllllll',
    '.....lhhwwhhwwhl',
    '...eesssssssssssh',
    '......dd.....dd',
    '..nnnnnnnnnnnnbb',
    '...dddddddddddd',
  ],
  'sonnet-0': [
    '..................dhhd',
    '.............llllllllllll',
    '.........eehhhhhwwhhhhwwhhhll',
    '.........eesssssssssssssssssssh',
    '............ddhhhhhhhhhhhhhhd',
    '............dd',
    '..nnnnnnnnnnnnnbb',
    '..nnnnnnnnnnnnnbb',
    '...ddddddddddddd',
  ],
  'sonnet-1': [
    '..........llllllllll',
    '.......llhhhhwwhhhhhhl',
    '....eehhhhhhhhhhhhhhhhhg',
    'nnnnnnnnnnnnsssssssssssh',
    'nnnnnnnnnnnnhhhhhhhhhhd',
    '..ddddddddddhhhhhhhd',
    '.........dddddd',
  ],
  'opus-0': [
    '...............................dhhd',
    '...........................llllllllllll',
    'nnnnnnnnnnnnnnnnnnnbb....llhhhhwwhhhhwwhhhhll',
    'nnnnnnnnnnnnnnnnnnnbb...ssssssssssssssssssssssh',
    '.ddddddddddddddddddd.....dhhhhhhhhhhhhhhhhhhd',
    '.....dd...................dddhhhhhdd',
    '......dd.....................dhhd',
    '.......dd...................dhhd',
    '........dhhhhhhhhhhhhhhhhhhhhhd',
    '......ehhhhwwhhhwwhhhhhhhhhhhhhgg',
    '......ehhssssssssssssssssssssshhgg',
    '........ddhhhhhhhhhhhhhhhhhhhd',
  ],
  'opus-1': [
    '......................ddhhd',
    '..................lllllllllllll',
    '.............lllhhhhwwhhhwwhhhhhll',
    '..........eehhhhssssssssssssssssssssh',
    '..........eehhhhhhhhhhhhhhhhhhhhhhhd',
    '..............ddhhhwwhhhhhhhhggd',
    '................ddhhhhhhhhhggd',
    '..............ddd..dddhhhhhdd',
    'nnnnnnnnnnnnnnnbb......dddd',
    'nnnnnnnnnnnnnnnbb',
    '.ddddddddddddddd',
  ],
  admiral: [
    '...........................................ddhhd',
    '.......................................llllllllllllll',
    '.................................lllhhhhhwwhhhwwhhhhwwhhhll',
    '...........................llllhhhhwwhhhhhhhhhhhhhhhhhhhhhhhhhll',
    '......................eehhhhhssssssssssssssssssssssssssssssssssssh',
    '......................eehhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhd',
    '...........................ddhhhhwwhhhhhwwhhhhhhhhhhhhhhhhhhhhd',
    '............................dd.dhhhhhhhhhhhhhhhhhhhhhhhhhggd',
    '.........................ddd....ddhhhhhhhhhhhhhhhhhhhhhggd',
    '..nnnnnnnnnnnnnnnnnnnnnnbb..........ddddhhhhhhhhhhhhdd',
    '..nnnnnnnnnnnnnnnnnnnnnnbb...............dddddd',
    '...dddddddddddddddddddddd',
  ],
}

export const SPRITES: Record<string, string[]> = Object.fromEntries(
  Object.entries(RAW).map(([k, rows]) => {
    const w = Math.max(...rows.map(r => r.length))
    return [k, rows.map(r => r.padEnd(w, '.'))]
  }),
)

export const STRIPE: Record<HullKey, string> = {
  haiku: '#5ee8c0',
  sonnet: '#f0a640',
  opus: '#b48cff',
  fable: '#ff7ab8',
  admiral: '#e8c35a',
}
export const CLASS_NAME: Record<HullKey, string> = {
  haiku: 'Shuttle',
  sonnet: 'Kreuzer',
  opus: 'Schwerer Kreuzer',
  fable: 'Forschungsschiff',
  admiral: 'Flaggschiff',
}
export const MODEL_LABEL: Record<HullKey, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  fable: 'Fable',
  admiral: 'Hauptsitzung',
}
export const HULL = { l: '#eef1f7', h: '#c3c9d8', d: '#646c84' }

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const WARP = ['2', '4', '6', '8', '9,9']
export const GLOW = ['#2f4fd0', '#3f8fff', '#4fd2ff', '#aef2ff', '#ffffff']
export const TRAIL = [3, 7, 12, 18, 26]

export const STATUS_LABEL = { run: 'Im Einsatz', wait: 'Gelber Alarm', done: 'Warpsprung', fail: 'Roter Alarm' }
export const STATUS_COLOR = { run: '#c9cff5', wait: '#ffcf40', done: '#8f96c8', fail: '#ff4d5e' }

export const ENTRY_MS = 800
export const EXIT_MS = 1400
export const FAIL_LINGER_MS = 8000

export function spriteKey(model: HullKey, variant: number): string {
  if (model === 'admiral') return 'admiral'
  return `${model === 'fable' ? 'opus' : model}-${variant % 2}`
}

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

export function leftmost(row: string): number {
  for (let c = 0; c < row.length; c++) if (row.charAt(c) !== '.') return c
  return -1
}

export function sprite(key: string): string[] {
  const rows = SPRITES[key]
  if (!rows) throw new Error(`unknown sprite ${key}`)
  return rows
}

export function widthOf(rows: readonly string[]): number {
  return rows[0]?.length ?? 0
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
