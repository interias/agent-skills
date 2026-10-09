// The tactical display (P5): `/taktik` opens a pane with a radar of the fleet. The bridge sits
// in the middle, each subagent is a contact whose distance grows with its run time. The
// desktop gets an animated SVG and a station list below it, the terminal a text version.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Alert, Ship } from '../types'
import { ALERT_COLOR, ALERT_LABEL, COLOR, stardate, stationOf, warpOf } from './lexicon'
import type { Station } from './lexicon'
import { INITIAL } from './state'
import { MODEL_LABEL, clip, fmtElapsed } from './sprites'

const PANE = 'taktik'
const TITLE = 'Taktisches Display'
const TICK_MS = 10_000

const fleet = atom({ plugin: 'agentenflotte', key: 'fleet' } as const, INITIAL.fleet)
const alert = atom({ plugin: 'agentenflotte', key: 'alert' } as const, INITIAL.alert)
const settings = atom({ plugin: 'agentenflotte', key: 'settings' } as const, INITIAL.settings)
// Beats of the ticker. The drawing reads it, so each beat draws this pane again and nothing else
// (`$.ui.invalidate('ui.render')` takes no matcher: it would draw the band again as well).
const tick = atom({ plugin: 'agentenflotte', key: 'taktikTick' } as const, 0)

const STATIONS: readonly Station[] = ['Wissenschaft', 'Maschinenraum', 'Taktik', 'Navigation', 'Brücke']

const MODEL_COLOR: Record<Ship['model'], string> = {
  haiku: COLOR.almond, sonnet: COLOR.bluey, opus: COLOR.violet, fable: COLOR.mauve,
}

// Radar geometry: a SVG of its own size (the desktop frame falls back to 300x150 without one).
const SIZE = 360
const MID = SIZE / 2
const RING_MAX = 165
const RING_MIN = 34
const FULL_MS = 10 * 60_000 // a contact reaches the outer ring after ten minutes
const SWEEP_SLICES = 6

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
const n1 = (v: number) => Math.round(v * 10) / 10

// Set while the pane is drawn, so the ticker redraws only then.
let isShown = false

/** A stable angle in degrees for an agent id (FNV-1a). */
export function angleOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % 360
}

/** The distance from the middle: logarithmic in the run time, capped at the outer ring. */
export function distanceOf(elapsedMs: number): number {
  const share = Math.min(1, Math.log1p(Math.max(0, elapsedMs) / 1000) / Math.log1p(FULL_MS / 1000))
  return RING_MIN + (RING_MAX - RING_MIN) * share
}

const elapsedOf = (s: Ship, now: number) => Math.max(0, (s.endedAt ?? now) - s.startedAt)

/** Subagents per station that are still at work. */
export function stationCounts(ships: readonly Ship[]): Record<Station, number> {
  const out: Record<Station, number> = { Wissenschaft: 0, Maschinenraum: 0, Taktik: 0, Navigation: 0, 'Brücke': 0 }
  for (const s of ships) if (s.status === 'run' || s.status === 'wait') out[stationOf(s.agentType)]++
  return out
}

const css = `
.sweep{transform-origin:${MID}px ${MID}px;animation:spin 4s linear infinite}
.blink{animation:blink 1s ease-in-out infinite}
.fade{animation:fade 2s ease-out forwards}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes blink{50%{opacity:.2}}
@keyframes fade{from{opacity:1}to{opacity:.35}}
@media (prefers-reduced-motion:reduce){.sweep,.blink,.fade{animation:none}}
text{font:10px sans-serif;fill:#cfd6ff}`

function contact(s: Ship, now: number): string {
  const ms = elapsedOf(s, now)
  const r = distanceOf(ms)
  const a = (angleOf(s.id) * Math.PI) / 180
  const x = n1(MID + r * Math.cos(a))
  const y = n1(MID + r * Math.sin(a))
  const color = s.status === 'fail' ? COLOR.rot : s.status === 'wait' ? COLOR.gelb : s.status === 'done' ? '#8f96c8' : MODEL_COLOR[s.model]
  // A negative delay puts a redraw back in the phase the animation had, so it does not start over.
  const cls = s.status === 'wait' ? ` class="blink" style="animation-delay:-${n1((now / 1000) % 1)}s"`
    : s.status === 'done' ? ` class="fade" opacity=".35" style="animation-delay:-${n1(Math.min(2, (now - (s.endedAt ?? now)) / 1000))}s"` : ''
  const label = esc(clip(s.desc || stationOf(s.agentType), 14))
  const left = x > MID + 40
  const tip = `${s.desc || s.agentType}\nModell: ${MODEL_LABEL[s.model]}\nWarp ${warpOf(s.effort)}\nLaufzeit ${fmtElapsed(ms)}`
  return (
    `<g${cls}><title>${esc(tip)}</title><circle cx="${x}" cy="${y}" r="5" fill="${color}"/>` +
    `<text x="${n1(left ? x - 9 : x + 9)}" y="${n1(y + 3)}" text-anchor="${left ? 'end' : 'start'}">${label}</text></g>`
  )
}

/** The radar as one SVG document; its frame takes the alert color. */
export function radarSvg(ships: readonly Ship[], now: number, level: Alert): { source: string; alt: string } {
  let rings = ''
  for (const r of [55, 110, RING_MAX]) rings += `<circle cx="${MID}" cy="${MID}" r="${r}" fill="none" stroke="${COLOR.lilac}" stroke-opacity=".5"/>`
  let wedge = ''
  for (let i = 0; i < SWEEP_SLICES; i++) {
    const a0 = (-8 * (i + 1) * Math.PI) / 180
    const a1 = (-8 * i * Math.PI) / 180
    const p = (a: number) => `${n1(MID + RING_MAX * Math.cos(a))} ${n1(MID + RING_MAX * Math.sin(a))}`
    wedge += `<path d="M${MID} ${MID} L${p(a0)} A${RING_MAX} ${RING_MAX} 0 0 1 ${p(a1)} Z" fill="${COLOR.bluey}" opacity="${n1(0.28 - i * 0.045)}"/>`
  }
  const dots = ships.map(s => contact(s, now)).join('')
  const empty = ships.length === 0 ? `<text x="${MID}" y="${MID + 38}" text-anchor="middle">Keine Kontakte</text>` : ''
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><style>${css}</style>` +
    `<circle cx="${MID}" cy="${MID}" r="${MID - 3}" fill="${COLOR.space}" stroke="${ALERT_COLOR[level]}" stroke-width="4"/>` +
    rings +
    `<path d="M${MID} 12V${SIZE - 12}M12 ${MID}H${SIZE - 12}" stroke="${COLOR.lilac}" stroke-opacity=".5"/>` +
    `<g class="sweep" style="animation-delay:-${n1((now / 1000) % 4)}s">${wedge}<line x1="${MID}" y1="${MID}" x2="${MID + RING_MAX}" y2="${MID}" stroke="${COLOR.bluey}" stroke-opacity=".7"/></g>` +
    `<g><title>Brücke (Hauptsitzung)</title><circle cx="${MID}" cy="${MID}" r="7" fill="${COLOR.orange}"/></g>` +
    dots + empty + '</svg>'
  const alt = `Radar: ${ships.length === 0 ? 'keine Kontakte' : `${ships.length} ${ships.length === 1 ? 'Kontakt' : 'Kontakte'}`}, ${ALERT_LABEL[level]}`
  return { source, alt }
}

const TERMINAL_MARK: Record<Ship['status'], string> = { run: '', wait: ' !', done: ' fertig', fail: ' Fehler' }

async function toggle($: EngineInterface) {
  if (!(await read($, settings)).all) return { text: 'Die Agentenflotte ist aus. Einschalten mit /flotte.' }
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    isShown = false
    return { text: `${TITLE} geschlossen.` }
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: `${TITLE} geöffnet.` }
}

export function registerTaktik(on: On) {
  on('session.start', {}, async ($, e, next) => {
    await $.command.register({ name: 'taktik', description: 'Taktisches Display mit dem Radar der Flotte öffnen oder schließen' })
    $.clock.every(TICK_MS, async () => {
      if (!isShown) return
      if (!(await $.ui.panes()).some(p => p.id === PANE)) {
        isShown = false
        return
      }
      await update($, tick, n => (n ?? 0) + 1)
    })
    return next(e)
  })

  on('command.run', { command: 'taktik' }, async $ => toggle($))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isShown = true
    await read($, tick)
    const ships = await read($, fleet)
    const level = await read($, alert)
    const now = await $.clock.now()

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text bold color={ALERT_COLOR[level]}>{`${ALERT_LABEL[level]} · Sternzeit ${stardate(now)}`}</Text>
          {ships.length === 0 && <Text dimColor>Keine Kontakte</Text>}
          {STATIONS.map(station => {
            const mine = ships.filter(s => stationOf(s.agentType) === station)
            return (
              <Box key={station} flexDirection="column">
                <Text bold={mine.length > 0} dimColor={mine.length === 0}>{`${station}${mine.length === 0 ? ' –' : ''}`}</Text>
                {mine.map(s => (
                  <Text key={s.id} color={s.status === 'wait' ? COLOR.gelb : s.status === 'fail' ? COLOR.rot : undefined} dimColor={s.status === 'done'}>
                    {`  ${clip(s.desc || s.agentType, 28)} W${warpOf(s.effort)} ${fmtElapsed(elapsedOf(s, now))}${TERMINAL_MARK[s.status]}`}
                  </Text>
                ))}
              </Box>
            )
          })}
        </Box>
      )
    }

    const { Box, Svg, Text } = $.ui.resolve(e)
    const svg = radarSvg(ships, now, level)
    const counts = stationCounts(ships)
    // All five stations stay listed so the rows do not jump as agents come and go.
    return (
      <Box flexDirection="column">
        <Svg source={svg.source} alt={svg.alt} width={SIZE} height={SIZE} />
        <Text color={ALERT_COLOR[level]}>{`${ALERT_LABEL[level]} · Sternzeit ${stardate(now)}`}</Text>
        {STATIONS.map(station => (
          <Text key={station} dimColor={counts[station] === 0}>{`${station}: ${counts[station]}`}</Text>
        ))}
      </Box>
    )
  })
}
