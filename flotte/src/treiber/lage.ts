// What happens to a mission, in one line for the cards of the bridge (Tag H): a label, one sentence with
// the reason, since when the state holds, and the person's step when it needs her. Deterministic from
// the state of the driver: stage, note, pause, limit, questions, merge queue, gate and the run's calls.
// No language model. The bridge draws it as it comes (flottenbruecke/SCHNITTSTELLE.md, `lage`).

import type { AgentEintrag } from '../werkzeuge/detail.ts';
import type { EpicStufe } from '../werkzeuge/zustand.ts';
import type { GateStand } from './pruefprotokolle.ts';

export type Etikett = 'arbeitet' | 'prueft' | 'wartet_auf_dich' | 'wartet' | 'gestoppt' | 'fertig';

export interface Lage {
  etikett: Etikett;
  satz: string;
  /** since when this state holds (ISO); the driver keeps it while label and kind stay the same */
  seit: string | null;
  /** the person's step, only when the mission needs her */
  deinSchritt: { text: string; ziel: 'frage' | 'pr' | 'einreihen' | 'issue' } | null;
  /** the gate of the run or the driver's Andockprüfung, its contexts from the gate logs */
  gate: { kontexte: { name: string; stand: 'fertig' | 'laeuft' }[]; von: number | null; seit: string | null } | null;
}

export interface LageEingang {
  nr: number;
  /** now, epoch ms */
  jetzt: number;
  stufe: EpicStufe;
  notiz: string;
  pr: number | null;
  /** a process of the run works right now */
  prozess: boolean;
  /** the admiral answers a question block of this mission right now (since, ISO) */
  beimAdmiral: string | null;
  /** a question block waits for an account with room for the admiral */
  frageWartet: boolean;
  /** open questions to the person: count and the oldest one's time */
  fragen: { anzahl: number; ganz: boolean; seit: string | null };
  pausiert: string | null;
  /** #199: nothing runs before this time (limit, 429), ISO */
  limitBis: string | null;
  /** the RAM brake holds new turns */
  ramHalt: boolean;
  /** position in the merge queue (1 = head), null outside */
  schlangePlatz: number | null;
  schlangeSeit: string | null;
  /** the driver's Andockprüfung runs since (ISO) */
  andockpruefung: string | null;
  /** the gate the run called and that has not returned: since (ISO) */
  gateLauf: string | null;
  /** the contexts of the gate from the logs of the mission's worktrees, null without logs */
  gateStand: GateStand | null;
  /** the Agent calls of the runs: the open ones name the package at work */
  agenten: AgentEintrag[];
  pakete: { fertig: number; gesamt: number };
  /** the run's last step (log), shown in the detail view of the bridge */
  schritt: string | null;
  /** #112: how the merge is done, with the switch's origin */
  merge: { stellung: 'automatisch' | 'mensch'; herkunft: 'projekt' | 'vorschlag' | 'epic' };
  /** blocked or aborted: the cause (#199) and the reason, since */
  haltUrsache: string | null;
  haltGrund: string | null;
  haltZeit: string | null;
  gemergtAm: string | null;
  gestartetAm: string | null;
}

/** the note prBereit writes; the reason in brackets is the one of menschPrueft or of the adapter */
export const MENSCH_DOCKT = /^PR #\d+ bereit, ein Mensch dockt an \((.*)\)$/s;
const KLASSE: Record<string, string> = { mechanisch: 'mechanisch', standard: 'Standard', urteil: 'Urteil', 'urteil-hoch': 'Urteil hoch' };

const erste = (s: string | null | undefined) => (s ?? '').split('\n')[0].trim();
const uhr = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

/** the open Agent calls of the run, newest last: a call without its return */
function offen(agenten: AgentEintrag[]): AgentEintrag[] {
  const zurueck = new Set(agenten.filter((a) => a.art === 'rueckkehr').map((a) => a.id));
  return agenten.filter((a) => a.art === 'aufruf' && !zurueck.has(a.id));
}

const paketName = (p: AgentEintrag['paket']) => (typeof p === 'number' ? `#${p}` : typeof p === 'string' ? `P${p.split('-p')[1] ?? p}` : '');

/** "Andockprüfung 3 von 5 Kontexten fertig, buero läuft", "…: 2 Kontexte fertig, buero läuft", "Andockprüfung läuft" */
export function gateSatz(g: GateStand | null, wort = 'Andockprüfung'): string {
  if (!g || !g.kontexte.length) return `${wort} läuft`;
  const fertig = g.kontexte.filter((k) => k.stand === 'fertig').length;
  const laeuft = g.kontexte.filter((k) => k.stand === 'laeuft').map((k) => k.name);
  const teil = laeuft.length ? `, ${laeuft.join(', ')} ${laeuft.length === 1 ? 'läuft' : 'laufen'}` : '';
  if (g.von) return `${wort} ${fertig} von ${g.von} Kontexten fertig${teil}`;
  return `${wort}: ${fertig} ${fertig === 1 ? 'Kontext' : 'Kontexte'} fertig${teil}`;
}

/**
 * The line of a mission without its time: `seit` is the natural start of the state where the driver
 * knows one (the oldest question, the pause, the halt, the queue, the gate), else null; the caller
 * keeps a tracked time for those (lageSeit).
 */
export function lageVon(e: LageEingang): Lage {
  const x = grundLage(e);
  // a question about a parked package while the run goes on: the line stays the run's, the step is the person's
  if (e.fragen.anzahl && !x.deinSchritt && x.etikett !== 'wartet_auf_dich') {
    const n = e.fragen.anzahl === 1 ? 'eine Frage' : `${e.fragen.anzahl} Fragen`;
    return { ...x, satz: `${x.satz}; ${n} an dich, ${e.fragen.anzahl === 1 ? 'ihr Paket ist' : 'ihre Pakete sind'} geparkt`, deinSchritt: { text: e.fragen.anzahl === 1 ? 'Frage beantworten' : 'Fragen beantworten', ziel: 'frage' } };
  }
  return x;
}

function grundLage(e: LageEingang): Lage {
  const l = (etikett: Etikett, satz: string, seit: string | null = null, deinSchritt: Lage['deinSchritt'] = null, gate: Lage['gate'] = null): Lage => ({ etikett, satz, seit, deinSchritt, gate });
  const gate = (seit: string | null): Lage['gate'] => ({ kontexte: (e.gateStand?.kontexte ?? []).map((k) => ({ name: k.name, stand: k.stand })), von: e.gateStand?.von ?? null, seit });
  const pr = e.pr ? `PR #${e.pr}` : 'der PR';

  if (e.stufe === 'gemergt' || e.stufe === 'fertig') return l('fertig', e.pr ? `${pr} angedockt` : 'fertig', e.gemergtAm);
  if (e.stufe === 'abgebrochen') return l('gestoppt', `Abgebrochen: ${erste(e.haltGrund) || erste(e.notiz) || 'ohne Grund'}`, e.haltZeit, { text: 'Ursache prüfen, dann neu einreihen oder aufgeben', ziel: 'einreihen' });
  if (e.stufe === 'blockiert') return l('gestoppt', `Blockiert${e.haltUrsache ? `, Ursache ${e.haltUrsache}` : ''}: ${erste(e.haltGrund) || erste(e.notiz) || 'ohne Grund'}`, e.haltZeit, { text: 'Ursache beheben, dann neu einreihen oder aufgeben', ziel: 'einreihen' });
  if (e.pausiert && !e.prozess) return l('wartet', 'von dir pausiert', e.pausiert);
  if (e.fragen.anzahl && (e.fragen.ganz || !e.prozess)) return l('wartet_auf_dich', `${e.fragen.anzahl === 1 ? 'eine Frage' : `${e.fragen.anzahl} Fragen`} an dich`, e.fragen.seit, { text: e.fragen.anzahl === 1 ? 'Frage beantworten' : 'Fragen beantworten', ziel: 'frage' });
  if (e.beimAdmiral) return l('wartet', 'Frage beim Admiral', e.beimAdmiral);
  if (e.frageWartet) return l('wartet', 'Frage beim Admiral, wartet auf ein Konto mit Luft');

  if (e.stufe === 'pr') {
    if (e.andockpruefung) return l('prueft', `${gateSatz(e.gateStand, 'Andockprüfung des Treibers')} (${pr})`, e.andockpruefung, null, gate(e.andockpruefung));
    const mensch = MENSCH_DOCKT.exec(e.notiz);
    if (mensch) {
      const schalter = e.merge.herkunft !== 'projekt' ? ' oder Schalter an der Mission auf automatisch' : '';
      return l('wartet_auf_dich', `${pr} fertig, Andocken nur durch dich (${mensch[1]})`, null, { text: `${pr} andocken${schalter}`, ziel: 'pr' });
    }
    if (/PR gehört nicht zur Mission/.test(e.notiz)) return l('wartet_auf_dich', `${pr} gehört nicht zur Mission`, null, { text: 'PR prüfen und an der Mission richtigstellen', ziel: 'issue' });
    if (e.prozess) return l('arbeitet', `Nacharbeit für die Andock-Schlange${e.schritt ? `: ${e.schritt}` : ''}`);
    const vor = /wartet auf das Andocken von (.+)$/.exec(e.notiz)?.[1];
    if (e.schlangePlatz) return l('wartet', `Andock-Schlange Platz ${e.schlangePlatz}, ${pr}${vor ? `, wartet auf das Andocken von ${vor}` : e.schlangePlatz === 1 ? ', als Nächstes dran' : ''}`, e.schlangeSeit);
    return l('wartet', e.notiz || `${pr} offen`);
  }

  if (e.stufe === 'wartend') return l('wartet', e.notiz || 'bereit, wartet auf einen freien Platz');

  // laeuft, nacharbeit, frage without open questions
  if (e.prozess) {
    if (e.gateLauf || e.gateStand?.kontexte.some((k) => k.stand === 'laeuft')) return l('prueft', gateSatz(e.gateStand), e.gateLauf ?? e.gateStand?.seit ?? null, null, gate(e.gateLauf ?? e.gateStand?.seit ?? null));
    const auf = offen(e.agenten).filter((a) => a.rolle === 'implementer' || a.rolle === 'reviewer');
    const stand = e.pakete.gesamt ? `, ${e.pakete.fertig} von ${e.pakete.gesamt} ${e.pakete.gesamt === 1 ? 'Paket' : 'Paketen'} fertig` : '';
    const prueft = auf.filter((a) => a.rolle === 'reviewer');
    const bauen = auf.filter((a) => a.rolle === 'implementer');
    if (bauen.length) {
      const k = bauen.at(-1)!.klasse;
      return l('arbeitet', `${bauen.length === 1 ? 'Ingenieur' : `${bauen.length} Ingenieure`} an ${bauen.map((a) => paketName(a.paket)).join(', ')}${bauen.length === 1 && k ? ` (${KLASSE[k] ?? k})` : ''}${prueft.length ? `, Erster Offizier prüft ${prueft.map((a) => paketName(a.paket)).join(', ')}` : ''}${stand}`);
    }
    if (prueft.length) return l('prueft', `Erster Offizier prüft ${prueft.map((a) => paketName(a.paket)).join(', ')}${stand}`);
    const still = /^still seit \d+ min, Kindprozess lebt: (.+)$/.exec(e.schritt ?? '');
    if (still) return l('arbeitet', `wartet auf eigene Hintergrundarbeit (${still[1]})`);
    return l('arbeitet', `${e.stufe === 'nacharbeit' ? 'Nacharbeit' : 'Orchestrierung'}${e.schritt ? `: ${e.schritt}` : ''}`);
  }
  if (e.limitBis && Date.parse(e.limitBis) > e.jetzt) return l('wartet', `Limit, weiter um ${uhr(e.limitBis)}${e.notiz.includes('429') ? ' (429)' : ''}`);
  if (/^wartet auf .+: Limit/.test(e.notiz)) return l('wartet', e.notiz.replace(/^wartet auf /, 'Limit auf ').replace(/: Limit erreicht: .*$/s, ', weiter sobald es Luft hat'));
  if (e.ramHalt || e.notiz === 'wartet auf RAM ok') return l('wartet', 'Speicher knapp, weiter sobald RAM ok');
  if (e.stufe === 'frage') return l('wartet', 'deine Antwort geht mit dem nächsten Zug an den Lauf');
  return l('wartet', e.notiz || (e.stufe === 'nacharbeit' ? 'Nacharbeit, nächster Zug folgt' : 'zwischen zwei Zügen'));
}

/** the kind of a line for its time: label and the sentence without numbers that move (positions, counts, steps) */
export const lageArt = (x: Lage) => `${x.etikett}|${x.satz.replace(/[:;].*$/s, '').replace(/\d+/g, '#')}`;
