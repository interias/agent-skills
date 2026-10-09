// The ship's computer (P4): its persona through prompt.compose, only while
// isOn($, 'computer') (off by default).

import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { INITIAL, isOn } from './state'

const settings = atom({ plugin: 'agentenflotte', key: 'settings' } as const, INITIAL.settings)

export const COMPUTER_SECTION = {
  id: 'agentenflotte:computer',
  scope: 'session',
  text:
    'Beginnt eine Nachricht des Nutzers mit „Computer,“, antwortest du für diese eine Nachricht im Ton eines Bordcomputers: ' +
    'sachlich, knapp, ohne Anrede und ohne Füllsätze, Zahlen zuerst. ' +
    'Das gilt nie für Code, Commit-Nachrichten, Pull-Request-Texte, Tickets, Dateien oder Berichte an Dritte. ' +
    'Ohne „Computer,“ antwortest du wie sonst.',
} as const

export function registerComputer(on: On) {
  on('prompt.compose', {}, async ($, e, next) => {
    const r = await next(e)
    if (!isOn(await read($, settings), 'computer')) return r
    return { sections: [...r.sections, COMPUTER_SECTION] }
  })
}
