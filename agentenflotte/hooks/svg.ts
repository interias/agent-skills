// The desktop drawing: one animated SVG (CSS keyframes, drawn by the Svg element with
// isInteractive so animations and <title> tooltips run). Redrawn only when the fleet
// changes; entry and exit animations take a negative delay so a redraw resumes them.

import type { Ship } from '../types'
import {
  CLASS_NAME, EFFORTS, ENTRY_MS, EXIT_MS, GLOW, HULL, MODEL_LABEL, STATUS_COLOR, at, sprite, widthOf,
  STATUS_LABEL, STRIPE, TRAIL, WARP, clip, fmtElapsed, leftmost, spriteKey,
} from './sprites'
import type { HullKey } from './sprites'

const W = 960
const H = 184
const PX = 2
const ROW_GAP = 46

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
    const x = n1(rnd() * W), y = n1(rnd() * H), z = 0.2 + rnd() * 0.8
    const len = n1(1 + warp * z * 14)
    dots += `<rect x="${x}" y="${y}" width="${len}" height="1" opacity="${n1(0.25 + z * 0.6)}"/>`
  }
  const dur = n1(60 / (0.4 + warp * 4))
  return `<g fill="#cfd6ff"><g class="stars" style="animation-duration:${dur}s">${dots}<g transform="translate(${W} 0)">${dots}</g></g></g>`
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

export function fleetSvg(fleet: readonly Ship[], now: number, isWorking: boolean): SvgFrame {
  const ships = [...fleet].sort((a, b) => a.startedAt - b.startedAt)
  const running = ships.filter(s => s.status === 'run')
  const warp = running.length ? Math.max(...running.map(s => (s.effort + 1) / 5)) : 0.1

  const admKey = 'admiral'
  const admW = widthOf(sprite(admKey)) * PX, admH = sprite(admKey).length * PX
  const ax = W - admW - 24
  const cy = Math.round(H / 2 - 6)
  const ay = cy - admH / 2
  const linkX = ax + 44, linkY = cy

  const cols = Math.max(1, Math.ceil(ships.length / 3))
  const colGap = Math.max(60, Math.min(132, (ax - 20) / (cols + 0.6)))
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
  placed.forEach((p, i) => {
    const s = p.ship
    const age = now - s.startedAt
    const title = `${s.desc}\n${s.agentType} · ${MODEL_LABEL[s.model]}-${CLASS_NAME[s.model]}\nDenkstufe ${at(EFFORTS, s.effort)} · Warp ${at(WARP, s.effort)} · ${fmtElapsed((s.endedAt ?? now) - s.startedAt)}\n${STATUS_LABEL[s.status]}`
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
@keyframes scroll{to{transform:translateX(-${W}px)}}
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
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`

  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMaxYMid meet" shape-rendering="crispEdges">` +
    `<style>${css}</style><defs>${defs}</defs>` +
    `<rect width="${W}" height="${H}" rx="8" fill="#05071a"/>` +
    stars(warp) + links + body + `</svg>`

  const alt = active
    ? `Agentenflotte: ${active} Agenten im Einsatz` +
      (ships.some(s => s.status === 'wait') ? `, ${ships.filter(s => s.status === 'wait').length} warten auf Freigabe` : '')
    : 'Agentenflotte: keine Agenten im Einsatz'
  return { source, alt }
}
