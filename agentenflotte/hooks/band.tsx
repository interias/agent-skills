// The band above the prompt: an animated SVG on the desktop, a half-block raster on the
// terminal, repainted by a ticker so the raster moves between redraws.

import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { ROWS, frame } from './raster'
import { INITIAL, isOn, mirrored, setMirror } from './state'
import { fleetSvg } from './svg'

const fleet = atom({ plugin: 'agentenflotte', key: 'fleet' } as const, INITIAL.fleet)
const settings = atom({ plugin: 'agentenflotte', key: 'settings' } as const, INITIAL.settings)

// The mounted terminal band the ticker repaints.
let site: { requestId: string; columns: number; isWorking: boolean } | null = null

async function paintTerminal($: EngineInterface) {
  if (!site) return
  const now = await $.clock.now()
  const f = frame(mirrored(), now, site.columns, site.isWorking)
  const res = await $.ui.blit({ requestId: site.requestId, key: 'convoy', cells: f.cells, columns: site.columns, rows: ROWS })
  if (res.deny !== undefined) site = null
}

export function registerBand(on: On) {
  on('session.start', {}, async ($, e, next) => {
    $.clock.every(120, () => void paintTerminal($))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ships = await read($, fleet)
    setMirror(ships)
    if (e.props.hasSurvey || !isOn(await read($, settings), 'band')) {
      site = null
      return next(e)
    }
    const now = await $.clock.now()

    if (e.surface === 'terminal') {
      const { Box, Raster, Text } = $.ui.resolve(e)
      const columns = Math.max(20, Math.min(512, e.props.bodyColumns))
      site = { requestId: e.requestId, columns, isWorking: e.props.isWorking }
      const f = frame(ships, now, columns, e.props.isWorking)
      return (
        <Box flexDirection="column">
          <Raster key="convoy" columns={columns} rows={ROWS} cells={f.cells} />
          <Text dimColor>{f.labels}</Text>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const svg = fleetSvg(ships, now, e.props.isWorking)
    return <Svg source={svg.source} alt={svg.alt} isInteractive />
  })
}
