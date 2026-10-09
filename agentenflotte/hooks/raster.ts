// The terminal drawing: half-block cells (two pixels per cell), the convoy in one lane
// behind the admiral ship. Repainted by $.ui.blit on a timer.

import type { Alert, Ship } from '../types'
import { ALERT_COLOR, ALERT_LABEL, warpOf } from './lexicon'
import {
  ENTRY_MS, EXIT_MS, GLOW, HULL, STRIPE, TRAIL, at, clip, leftmost, sprite, spriteKey, widthOf,
} from './sprites'
import type { HullKey } from './sprites'

export const ROWS = 6
const PXH = ROWS * 2
const DEFAULT = 0x01000000
const GAP = 3
const CAP = 2
const MIN_SLOT = 19

const hex = (c: string) => parseInt(c.slice(1), 16)

function color(ch: string, model: HullKey, effort: number, status: Ship['status'], blink: boolean): number {
  const live = status === 'run' || status === 'done'
  switch (ch) {
    case 'l': case 'h': case 'd': return hex(HULL[ch])
    case 's': return hex(status === 'fail' && blink ? '#ff4d5e' : STRIPE[model])
    case 'w': return hex(status === 'wait' ? (blink ? '#ffcf40' : '#5a4a10') : status === 'fail' ? '#ff4d5e' : '#ffe9a0')
    case 'n': return hex(live ? at(GLOW, effort) : '#2c3360')
    case 'b': return hex(live || status === 'wait' ? '#ff5a3c' : '#5a2a2a')
    case 'e': return hex(live ? '#ff7a3a' : '#4a2a20')
    case 'g': return hex(live ? '#5fd4ff' : '#2a3a5a')
  }
  return DEFAULT
}

export type Slot = { ship: Ship | null; x: number; width: number }
export type RasterFrame = { cells: string; labels: string; slots: Slot[] }

export function layout(fleet: readonly Ship[], columns: number): Slot[] {
  const adm = widthOf(sprite('admiral'))
  const slots: Slot[] = [{ ship: null, x: columns - adm - 1, width: adm }]
  let right = columns - adm - 1 - GAP
  for (const ship of [...fleet].sort((a, b) => a.startedAt - b.startedAt)) {
    const w = widthOf(sprite(spriteKey(ship.model, ship.variant)))
    const slotW = Math.max(w, MIN_SLOT)
    if (right - slotW - at(TRAIL, ship.effort) < CAP) break
    slots.push({ ship, x: right - slotW + (slotW - w), width: slotW })
    right -= slotW + GAP
  }
  return slots
}

export function frame(fleet: readonly Ship[], now: number, columns: number, isWorking: boolean, alert: Alert = 'normal'): RasterFrame {
  const px: (number | null)[] = Array(PXH * columns).fill(null)
  const put = (x: number, y: number, c: number) => {
    if (x >= 0 && x < columns && y >= 0 && y < PXH) px[y * columns + x] = c
  }
  const tick = Math.floor(now / 120)
  const blink = Math.floor(now / 500) % 2 === 0
  const slots = layout(fleet, columns)

  for (const slot of slots) {
    const s = slot.ship
    const model: HullKey = s ? s.model : 'admiral'
    const key = s ? spriteKey(s.model, s.variant) : 'admiral'
    const rows = sprite(key)
    const w = widthOf(rows)
    const effort = s ? s.effort : 2
    const status: Ship['status'] = s ? s.status : isWorking ? 'run' : 'wait'
    const oy = Math.floor((PXH - rows.length) / 2)
    let x = slot.x
    let streak = 0

    if (s && now - s.startedAt < ENTRY_MS) {
      const k = (now - s.startedAt) / ENTRY_MS, e = 1 - Math.pow(1 - k, 3)
      x = Math.round(-w + (slot.x + w) * e)
      streak = x
    }
    if (s && s.status === 'done' && s.endedAt !== null) {
      const k = (now - s.endedAt) / EXIT_MS
      if (k >= 1) continue
      x = Math.round(slot.x + k * k * columns * 1.2)
      for (let c = slot.x; c < Math.min(columns, x); c++) put(c, oy + Math.floor(rows.length / 2), hex('#cfe8ff'))
    }
    for (let c = 0; c < streak; c++) if ((c + tick) % 3) put(c, oy + Math.floor(rows.length / 2), hex('#cfe8ff'))

    rows.forEach((row, r) => {
      for (let c = 0; c < w; c++) if (row.charAt(c) !== '.') put(x + c, oy + r, color(row.charAt(c), model, effort, status, blink))
      const c0 = leftmost(row)
      if (status === 'run' && c0 >= 0 && row.charAt(c0) === 'n') {
        const len = Math.ceil(at(TRAIL, effort) / 2)
        for (let i = 1; i <= len; i++) if ((i + r + tick) % 4) put(x + c0 - i, oy + r, hex(at(GLOW, effort)))
      }
    })
  }

  // The cap: the alert color down the left edge, rounded at both ends.
  const cap = hex(ALERT_COLOR[alert])
  for (let y = 0; y < PXH; y++) for (let x = 0; x < CAP; x++) {
    if (x === 0 && (y === 0 || y === PXH - 1)) px[y * columns + x] = null
    else put(x, y, cap)
  }

  const words = new Uint32Array(columns * ROWS * 3)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < columns; c++) {
      const top = px[r * 2 * columns + c] ?? null, bot = px[(r * 2 + 1) * columns + c] ?? null
      const i = (r * columns + c) * 3
      if (top !== null) { words[i] = 0x2580; words[i + 1] = top; words[i + 2] = bot ?? DEFAULT }
      else if (bot !== null) { words[i] = 0x2584; words[i + 1] = bot; words[i + 2] = DEFAULT }
      else {
        const star = ((c * 7 + r * 13 + tick) % 97) === 0
        words[i] = star ? 0x00b7 : 0x20; words[i + 1] = star ? 0x5b6390 : DEFAULT; words[i + 2] = DEFAULT
      }
    }
  }
  const bytes = new Uint8Array(words.buffer) as unknown as { toBase64(): string }

  let labels = alert === 'normal' ? '' : `${ALERT_LABEL[alert]} `
  for (const slot of [...slots].reverse()) {
    const pad = Math.max(0, slot.x - labels.length)
    const s = slot.ship
    const text = s
      ? (() => {
          const head = s.status === 'wait' ? '! ' : '', tail = ` W${warpOf(s.effort)}`
          return head + clip(s.desc, slot.width - 1 - head.length - tail.length) + tail
        })()
      : '★ HAUPTSITZUNG'
    labels += ' '.repeat(pad) + text
  }
  return { cells: bytes.toBase64(), labels, slots }
}
