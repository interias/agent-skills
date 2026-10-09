// Writes vorschau.html: the mod's own desktop drawing (fleetSvg) with a sample fleet from an /epic run.
import { writeFileSync } from 'node:fs'

import { fleetSvg } from '../../agentenflotte/hooks/svg'
import type { Ship } from '../../agentenflotte/types'

const now = 600_000
const ship = (i: number, desc: string, agentType: string, model: Ship['model'], effort: number, variant: number, status: Ship['status'] = 'run'): Ship =>
  ({ id: `s${i}`, desc, agentType, model, effort, variant, status, startedAt: now - 60_000 + i * 1000, endedAt: null })

// Lanes fill centre, top, bottom per column, oldest ship nearest the flagship.
const fleet = [
  ship(0, 'Paket 3: Urteil', 'epic-implementer-urteil', 'opus', 1, 0),
  ship(1, 'Fundstellen', 'epic-kundschafter', 'haiku', 0, 0),
  ship(2, 'Review Paket 1', 'epic-reviewer-standard', 'sonnet', 2, 1, 'wait'),
  ship(3, 'Paket 2', 'epic-implementer-standard', 'sonnet', 1, 0),
  ship(4, 'Labels zählen', 'epic-kundschafter', 'haiku', 0, 1),
  ship(5, 'Eskalation', 'epic-implementer-urteil-hoch', 'opus', 4, 1),
]

const { source } = fleetSvg(fleet, now, true, 'gelb')
writeFileSync(new URL('./vorschau.html', import.meta.url),
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>${source}\n`)
