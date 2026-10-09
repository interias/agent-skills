// The desktop drawing: one animated SVG (CSS keyframes), drawn by the Svg element as an
// image: the interactive frame keeps the iframe default of 300x150 on the desktop. Redrawn
// only when the fleet changes; entry and exit animations take a negative delay so a redraw
// resumes them.
// A console frame: a cap on the left (alert color, data cascade), a bar on top, the sky
// in the middle and a roster of pills, one per subagent, below.

import type { Alert, Ship } from '../types'
import { ALERT_COLOR, ALERT_LABEL, COLOR, stationOf, warpOf } from './lexicon'
import {
  CLASS_NAME, EFFORTS, ENTRY_MS, EXIT_MS, GLOW, HULL, MODEL_LABEL, STATUS_COLOR, at, sprite, widthOf,
  STATUS_LABEL, STRIPE, TRAIL, WARP, clip, fmtElapsed, leftmost, spriteKey,
} from './sprites'
import type { HullKey } from './sprites'

const W = 960
const H = 240
const PX = 2
const ROW_GAP = 40
const CAP_W = 132
const CAP_R = 36
const SKY_X = CAP_W + 8
const SKY_Y = 20
const SKY_H = 150
const SKY_W = W - SKY_X
const ROSTER_Y = 180
const PILL_H = 22
const PILL_GAP = 6
const CHAR_W = 6.7

const PILL_COLOR: Record<Ship['model'], string> = {
  haiku: COLOR.almond, sonnet: COLOR.bluey, opus: COLOR.violet, fable: COLOR.mauve,
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
const n1 = (v: number) => Math.round(v * 10) / 10

const FILL: Record<string, string> = {
  l: HULL.l, h: HULL.h, d: HULL.d,
  s: 'var(--s)', w: 'var(--w)', n: 'var(--n)', b: 'var(--b)', e: 'var(--e)', g: 'var(--g)',
}

function symbol(key: string): string {
  const rows = sprite(key)
  let out = ''
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row.charAt(x)
      let end = x + 1
      while (end < row.length && row.charAt(end) === ch) end++
      if (ch !== '.') out += `<rect x="${x}" y="${y}" width="${end - x}" height="1" style="fill:${FILL[ch]}"/>`
      x = end
    }
  })
  return `<symbol id="sp-${key}" overflow="visible">${out}</symbol>`
}

function stars(warp: number): string {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let dots = ''
  for (let i = 0; i < 70; i++) {
    const x = n1(SKY_X + rnd() * SKY_W), y = n1(SKY_Y + rnd() * SKY_H), z = 0.2 + rnd() * 0.8
    const len = n1(1 + warp * z * 14)
    dots += `<rect x="${x}" y="${y}" width="${len}" height="1" opacity="${n1(0.25 + z * 0.6)}"/>`
  }
  const dur = n1(60 / (0.4 + warp * 4))
  return `<g fill="#cfd6ff"><g class="stars" style="animation-duration:${dur}s">${dots}<g transform="translate(${SKY_W} 0)">${dots}</g></g></g>`
}

type Pill = { ship: Ship; text: string; w: number }

function pillOf(s: Ship): Pill {
  const text = `${s.status === 'wait' ? '! ' : ''}${stationOf(s.agentType)} · ${clip(s.desc, 18)} · W${warpOf(s.effort)}`
  return { ship: s, text, w: Math.round(text.length * CHAR_W + 18) }
}

// Two rows at most; what does not fit becomes a "+n weitere" pill at the end of row two.
function rosterRows(pills: Pill[]): { rows: Pill[][]; more: number } {
  const limit = W - SKY_X - 8
  const moreW = Math.round('+99 weitere'.length * CHAR_W + 18)
  for (let k = pills.length; k >= 0; k--) {
    const trimmed = k < pills.length
    const rows: Pill[][] = [[]]
    let used = 0
    let ok = true
    for (const p of pills.slice(0, k)) {
      const room = rows.length === 2 && trimmed ? limit - moreW - PILL_GAP : limit
      if (used + p.w > room) {
        if (rows.length === 2) { ok = false; break }
        rows.push([])
        used = 0
        if (p.w > (trimmed ? limit - moreW - PILL_GAP : limit)) { ok = false; break }
      }
      rows[rows.length - 1]!.push(p)
      used += p.w + PILL_GAP
    }
    if (ok) return { rows, more: pills.length - k }
  }
  return { rows: [[]], more: pills.length }
}

function roster(ships: readonly Ship[], titles: Map<string, string>): string {
  const { rows, more } = rosterRows(ships.map(pillOf))
  let out = ''
  const draw = (x: number, y: number, w: number, cls: string, fill: string, text: string, title: string) => {
    out +=
      `<g class="${cls}"><title>${esc(title)}</title><rect x="${x}" y="${y}" width="${w}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${fill}"/>` +
      `<text x="${x + 9}" y="${y + 15}" class="pt">${esc(text)}</text></g>`
  }
  rows.forEach((row, r) => {
    let x = SKY_X
    const y = ROSTER_Y + r * (PILL_H + PILL_GAP)
    for (const p of row) {
      const st = p.ship.status
      const fill = st === 'wait' ? COLOR.gelb : st === 'fail' ? COLOR.rot : st === 'done' ? '#7b7f99' : PILL_COLOR[p.ship.model]
      draw(x, y, p.w, st === 'wait' ? 'pill wait' : st === 'fail' ? 'pill lost' : 'pill', fill, p.text, titles.get(p.ship.id) ?? '')
      x += p.w + PILL_GAP
    }
    if (r === 1 && more > 0) {
      const text = `+${more} weitere`
      draw(x, y, Math.round(text.length * CHAR_W + 18), 'pill', COLOR.lilac, text, `${more} weitere Schiffe`)
    }
  })
  return out
}

// Small number blocks in the cap; while working they swap between two sets in steps.
function cascade(isWorking: boolean): string {
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const num = () => Math.floor(rnd() * 256).toString(16).toUpperCase().padStart(2, '0')
  let out = ''
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 16 + c * 34, y = 92 + r * 14
      const d = n1(((r * 3 + c) * 0.37) % 0.9)
      out +=
        `<text x="${x}" y="${y}" class="ca" style="animation-delay:-${d}s">${num()}</text>` +
        `<text x="${x}" y="${y}" class="cb" style="animation-delay:-${d}s">${num()}</text>`
    }
  }
  return `<g class="${isWorking ? 'cascade on' : 'cascade'}" aria-hidden="true">${out}</g>`
}

function frameOf(alert: Alert, active: number, isWorking: boolean): string {
  const color = ALERT_COLOR[alert]
  const bottom = SKY_Y + SKY_H
  const cap = `<path d="M${CAP_W} 0H${CAP_R}A${CAP_R} ${CAP_R} 0 0 0 0 ${CAP_R}V${bottom - CAP_R}A${CAP_R} ${CAP_R} 0 0 0 ${CAP_R} ${bottom}H${CAP_W}Z" fill="${color}"/>`
  const segs = [[SKY_X, 300], [SKY_X + 308, 330], [SKY_X + 646, SKY_W - 646]]
  const bar = segs.map(([x, w]) => `<rect x="${x}" y="0" width="${w}" height="14" rx="3" fill="${color}"/>`).join('')
  const title = alert === 'normal'
    ? `<text x="16" y="46" class="cap">FLOTTE</text>`
    : `<text x="16" y="46" class="cap small">${esc(ALERT_LABEL[alert])}</text>`
  const count = `<text x="16" y="64" class="capsub">${active ? `${active} IM EINSATZ` : 'BEREIT'}</text>`
  return cap + bar + title + count + cascade(isWorking)
}

type Placed = { ship: Ship; key: string; x: number; y: number; w: number; h: number }

function vars(model: HullKey, effort: number, status: Ship['status'] | 'admiral', isWorking: boolean): string {
  const live = status === 'run' || status === 'done' || (status === 'admiral' && isWorking)
  const win = status === 'wait' ? '#ffcf40' : status === 'fail' ? '#ff4d5e' : '#ffe9a0'
  return [
    `--s:${STRIPE[model]}`,
    `--w:${win}`,
    `--n:${live ? at(GLOW, status === 'done' ? 4 : effort) : '#2c3360'}`,
    `--b:${live || status === 'wait' ? '#ff5a3c' : '#5a2a2a'}`,
    `--e:${live ? '#ff7a3a' : '#4a2a20'}`,
    `--g:${live ? '#5fd4ff' : '#2a3a5a'}`,
  ].join(';')
}

function trails(key: string, effort: number): string {
  const rows = sprite(key)
  let out = ''
  rows.forEach((row, y) => {
    const c0 = leftmost(row)
    if (c0 < 0) return
    if (row.charAt(c0) === 'n') {
      const len = at(TRAIL, effort)
      out += `<rect x="${c0 - len}" y="${y}" width="${len}" height="1" fill="url(#tr${effort})" class="flick" style="animation-delay:-${n1((y * 0.13) % 0.5)}s"/>`
    } else if (row.charAt(c0) === 'e') {
      out += `<rect x="${c0 - 2}" y="${y}" width="2" height="1" fill="#ff7a3a" opacity=".5"/>`
    }
  })
  return out
}

function shipBody(p: Placed, isAdmiral: boolean, isWorking: boolean): string {
  const s = p.ship
  const rows = sprite(p.key)
  const sw = widthOf(rows), sh = rows.length
  const model: HullKey = isAdmiral ? 'admiral' : s.model
  const live = isAdmiral ? isWorking : s.status === 'run'
  let inner = ''
  if (live && s.effort === 4) {
    inner += `<ellipse cx="${sw / 2}" cy="${sh / 2}" rx="${sw / 2 + 4}" ry="${sh / 2 + 4}" class="shield"/>`
  }
  if (live) inner += trails(p.key, s.effort)
  inner += `<use href="#sp-${p.key}"/>`
  if (s.status === 'wait') inner += `<text x="${Math.round(sw * 0.6)}" y="-2" class="bang">!</text>`
  return `<g transform="scale(${PX})" style="${vars(model, s.effort, isAdmiral ? 'admiral' : s.status, isWorking)}">${inner}</g>`
}

export type SvgFrame = { source: string; alt: string }

export function fleetSvg(fleet: readonly Ship[], now: number, isWorking: boolean, alert: Alert = 'normal'): SvgFrame {
  const ships = [...fleet].sort((a, b) => a.startedAt - b.startedAt)
  const running = ships.filter(s => s.status === 'run')
  const warp = running.length ? Math.max(...running.map(s => (s.effort + 1) / 5)) : 0.1

  const admKey = 'admiral'
  const admW = widthOf(sprite(admKey)) * PX, admH = sprite(admKey).length * PX
  const ax = W - admW - 24
  const cy = Math.round(SKY_Y + SKY_H / 2 - 6)
  const ay = cy - admH / 2
  const linkX = ax + 44, linkY = cy

  const cols = Math.max(1, Math.ceil(ships.length / 3))
  const colGap = Math.max(60, Math.min(132, (ax - SKY_X - 20) / (cols + 0.6)))
  const placed: Placed[] = ships.map((ship, i) => {
    const key = spriteKey(ship.model, ship.variant)
    const w = widthOf(sprite(key)) * PX, h = sprite(key).length * PX
    const lane = at([0, -1, 1], i % 3), col = Math.floor(i / 3)
    const x = Math.round(ax - 20 - col * colGap - (lane ? colGap * 0.5 : 0) - w)
    const y = Math.round(cy + lane * ROW_GAP - h / 2)
    return { ship, key, x, y, w, h }
  })
  const keys = new Set(placed.map(p => p.key).concat(admKey))

  const defs =
    [...keys].map(symbol).join('') +
    GLOW.map((g, i) => `<linearGradient id="tr${i}"><stop offset="0" stop-color="${g}" stop-opacity="0"/><stop offset="1" stop-color="${g}" stop-opacity=".9"/></linearGradient>`).join('')

  let links = ''
  let body = ''
  const titles = new Map<string, string>()
  placed.forEach((p, i) => {
    const s = p.ship
    const age = now - s.startedAt
    const title = `${s.desc}\n${s.agentType} · ${MODEL_LABEL[s.model]}-${CLASS_NAME[s.model]}\nDenkstufe ${at(EFFORTS, s.effort)} · Warp ${at(WARP, s.effort)} · ${fmtElapsed((s.endedAt ?? now) - s.startedAt)}\n${STATUS_LABEL[s.status]}`
    titles.set(s.id, title)
    const midY = p.y + p.h / 2

    if (s.status !== 'done' && age >= ENTRY_MS) {
      const cls = s.status === 'run' ? 'link' : s.status === 'wait' ? 'link wait' : 'link fail'
      links += `<line x1="${p.x + p.w + 3}" y1="${midY}" x2="${linkX}" y2="${linkY}" class="${cls}"/>`
    }

    let anim = ''
    let extra = ''
    if (s.status === 'done' && s.endedAt !== null) {
      const d = n1((now - s.endedAt) / 1000)
      anim = `class="exit" style="animation-delay:-${d}s"`
      extra = `<g transform="translate(${p.x + p.w} ${midY})"><g class="flash fx" style="animation-delay:-${d}s"><rect x="-30" y="-1" width="60" height="2"/><rect x="-1" y="-12" width="2" height="24"/><circle r="5"/></g></g>`
    } else if (age < ENTRY_MS) {
      const d = n1(age / 1000)
      anim = `class="enter" style="animation-delay:-${d}s"`
      extra =
        `<rect x="0" y="${midY - 1}" width="${p.x}" height="2" class="streak" style="animation-delay:-${d}s"/>` +
        `<g transform="translate(${p.x + p.w} ${midY})"><g class="flash fi" style="animation-delay:-${d}s"><rect x="-30" y="-1" width="60" height="2"/><rect x="-1" y="-12" width="2" height="24"/><circle r="5"/></g></g>`
    } else if (s.status === 'fail') {
      anim = `class="fail"`
    }

    const label = s.status === 'done'
      ? ''
      : `<text x="${p.x}" y="${p.y + p.h + 12}" class="lbl" fill="${STATUS_COLOR[s.status]}">${esc(clip(s.desc, 18))}</text>`
    body +=
      extra +
      `<g ${anim}><g class="bob" style="animation-delay:-${n1(i * 0.7)}s"><g transform="translate(${p.x} ${p.y})"><title>${esc(title)}</title>${shipBody(p, false, isWorking)}</g></g>${label}</g>`
  })

  const active = ships.filter(s => s.status === 'run' || s.status === 'wait').length
  const admiral: Ship = {
    id: 'admiral', agentType: 'Hauptsitzung', desc: 'Hauptsitzung', model: 'opus', effort: 2,
    variant: 0, status: 'run', startedAt: now, endedAt: null,
  }
  const pips = [0, 1, 2, 3].map(k => `<circle cx="${ax + 160 + k * 10}" cy="${ay + admH + 13}" r="3"/>`).join('')
  body +=
    `<g class="bob"><g transform="translate(${ax} ${ay})"><title>Hauptsitzung · Flaggschiff · koordiniert ${active} Schiffe</title>` +
    shipBody({ ship: admiral, key: admKey, x: ax, y: ay, w: admW, h: admH }, true, isWorking) +
    `</g></g><text x="${ax + 44}" y="${ay + admH + 17}" class="lbl" fill="#e8c35a">HAUPTSITZUNG</text><g fill="#e8c35a">${pips}</g>`

  const css = `
.stars{animation:scroll linear infinite}
@keyframes scroll{to{transform:translateX(-${SKY_W}px)}}
.bob{animation:bob 3.2s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(1.5px)}}
.flick{animation:flick .45s steps(3) infinite}
@keyframes flick{50%{opacity:.55}}
.shield{fill:none;stroke:#7fd8ff;stroke-width:.6;stroke-dasharray:1.5 1.5;animation:shield 1.6s ease-in-out infinite}
@keyframes shield{50%{opacity:.25}}
.bang{fill:#ffcf40;font:bold 8px monospace;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.link{stroke:#4a62d8;stroke-width:1;stroke-dasharray:2 8;opacity:.6;animation:flow 1.2s linear infinite}
.link.wait{stroke:#ffcf40;stroke-dasharray:4 4;opacity:.9;animation:blink 1s steps(1) infinite}
.link.fail{stroke:#ff4d5e;stroke-dasharray:4 4;opacity:.9;animation:blink .6s steps(1) infinite}
@keyframes flow{to{stroke-dashoffset:-20}}
.lbl{font:11px ui-monospace,Consolas,monospace;letter-spacing:.04em}
.enter{transform-box:fill-box;transform-origin:100% 50%;animation:enter ${ENTRY_MS}ms cubic-bezier(.15,.85,.3,1) both}
@keyframes enter{0%{transform:translateX(-1000px) scaleX(12);opacity:.3}75%{transform:translateX(0) scaleX(1.25);opacity:1}100%{transform:none}}
.exit{transform-box:fill-box;transform-origin:0 50%;animation:exit ${EXIT_MS}ms ease-in both}
@keyframes exit{0%{transform:none}32%{transform:translateX(-24px)}100%{transform:translateX(1400px) scaleX(30);opacity:0}}
.streak{fill:#cfe8ff;animation:streak ${ENTRY_MS}ms ease-out both}
@keyframes streak{0%{opacity:.8}100%{opacity:0}}
.flash{fill:#fff;opacity:0}
.fi{animation:fi ${ENTRY_MS}ms linear both}
@keyframes fi{0%,60%{opacity:0;transform:scale(.2)}75%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.6)}}
.fx{animation:fx ${EXIT_MS}ms linear both}
@keyframes fx{0%,40%{opacity:0;transform:scale(.2)}52%{opacity:1;transform:scale(1.2)}100%{opacity:0;transform:scale(2)}}
.fail{animation:sink 8s ease-in both;filter:sepia(1) saturate(5) hue-rotate(-40deg)}
@keyframes sink{to{transform:translateY(14px);opacity:.35}}
.cap{font:bold 17px ui-monospace,Consolas,monospace;letter-spacing:.06em;fill:#000}
.cap.small{font-size:11px;letter-spacing:0}
.capsub{font:10px ui-monospace,Consolas,monospace;fill:#000}
.cascade text{font:9px ui-monospace,Consolas,monospace;fill:#000;opacity:.65}
.cascade .cb{opacity:0}
.cascade.on .ca{animation:ca .9s steps(1) infinite}
.cascade.on .cb{animation:cb .9s steps(1) infinite}
@keyframes ca{50%{opacity:0}}
@keyframes cb{50%{opacity:.65}}
.pt{font:11px ui-monospace,Consolas,monospace;fill:#05071a}
.pill.wait{animation:blink 1s steps(1) infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`

  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMaxYMid meet" shape-rendering="crispEdges">` +
    `<style>${css}</style><defs>${defs}</defs>` +
    `<clipPath id="sky"><rect x="${SKY_X}" y="${SKY_Y}" width="${SKY_W}" height="${SKY_H}"/></clipPath>` +
    `<rect width="${W}" height="${H}" rx="8" fill="${COLOR.space}"/>` +
    frameOf(alert, active, isWorking) +
    `<g clip-path="url(#sky)">` + stars(warp) + links + body + `</g>` +
    roster(ships, titles) + `</svg>`

  const alt = active
    ? `Agentenflotte: ${active} Agenten im Einsatz` +
      (ships.some(s => s.status === 'wait') ? `, ${ships.filter(s => s.status === 'wait').length} warten auf Freigabe` : '')
    : 'Agentenflotte: keine Agenten im Einsatz'
  return { source, alt }
}
