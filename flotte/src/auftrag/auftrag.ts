// The order writer (agent-skills/ADR-0002): the one place that checks a draft against the adapter of
// the target repository, builds the bodies (list, order, "Teil von #…") and picks the labels. The
// forge only creates, edits and links issues (interface Forge); GitHub in github.ts, Gitea in #73.
// Draft format: flotte/README.md, "Aufträge".

/** What a forge must do for the order writer. Every method throws on failure. */
export interface Forge {
  /** Creates an issue; labels missing in the repository are created first. */
  anlegen(issue: { titel: string; body: string; labels: string[] }): Promise<AngelegtesIssue>;
  /** Replaces the body of an issue. */
  bodySetzen(nummer: number, body: string): Promise<void>;
  /** Links ziel to mission (GitHub: sub-issue; a forge without sub-issues: its own kind of edge). */
  verknuepfen(mission: number, ziel: number): Promise<void>;
}

export interface AngelegtesIssue {
  nummer: number;
  url: string;
}

/** What the adapter of the target repository says about issues (epic/references/adapter.md, "Issues"). */
export interface AuftragsRegeln {
  epic_label: string;
  ready_label: string;
  /** the first present one counts */
  acceptance_section: string[];
  verification_section: string;
  modules_section: string;
}

export const TRIAGE_LABEL = 'needs-triage';
export const REIHENFOLGE_STANDARD = '> **Reihenfolge:** von oben nach unten, soweit Kollisionen es verlangen.';

export interface Teil {
  titel: string;
  text: string;
}

export interface Entwurf {
  mission: Teil | null;
  ziele: Teil[];
}

const KOPF = /^#\s+(Mission|Missionsziel):\s*(.*?)\s*$/;
const ZAUN = /^\s*(```|~~~)/;

/** The lines of a text with a flag for "inside a code fence", so headings in code count for nothing. */
function zeilenMitZaun(text: string): { z: string; code: boolean }[] {
  let offen: string | null = null;
  return text.split(/\r?\n/).map((z) => {
    const m = ZAUN.exec(z);
    if (m) {
      if (!offen) offen = m[1];
      else if (m[1] === offen) offen = null;
      return { z, code: true };
    }
    return { z, code: offen !== null };
  });
}

/** Splits a draft at its `# Mission:` and `# Missionsziel:` headings. Throws on a draft of the wrong shape. */
export function entwurfLesen(text: string): Entwurf {
  const teile: { art: string; titel: string; zeilen: string[] }[] = [];
  const davor: string[] = [];
  const fehler: string[] = [];
  for (const { z, code } of zeilenMitZaun(text.replace(/^﻿/, ''))) {
    const m = code ? null : KOPF.exec(z);
    // a mistyped heading would otherwise vanish into the Missionsziel above it
    if (!code && !m && /^#\s/.test(z)) fehler.push(`Überschrift erster Ebene weder \`# Mission:\` noch \`# Missionsziel:\`: ${z.trim()}`);
    if (m) teile.push({ art: m[1], titel: m[2], zeilen: [] });
    else (teile.length ? teile[teile.length - 1].zeilen : davor).push(z);
  }
  if (davor.some((z) => z.trim())) fehler.push('Text vor der ersten Überschrift `# Mission:` oder `# Missionsziel:`.');
  if (!teile.length) fehler.push('Keine Überschrift `# Mission:` oder `# Missionsziel:`.');
  teile.forEach((t, i) => {
    if (!t.titel) fehler.push(`Überschrift ${i + 1} (\`# ${t.art}:\`) ohne Titel.`);
    if (t.art === 'Mission' && i > 0) fehler.push('`# Mission:` steht nicht am Anfang oder mehr als einmal.');
  });
  const mission = teile[0]?.art === 'Mission' ? teile[0] : null;
  const ziele = teile.filter((t) => t.art === 'Missionsziel');
  if (mission && !ziele.length) fehler.push('Die Mission hat kein Missionsziel.');
  if (!mission && ziele.length > 1) fehler.push('Mehrere Missionsziele ohne `# Mission:` darüber.');
  if (fehler.length) throw new Error(`Entwurf unbrauchbar:\n- ${fehler.join('\n- ')}`);
  const teil = (t: { titel: string; zeilen: string[] }): Teil => ({ titel: t.titel, text: t.zeilen.join('\n').trim() });
  return { mission: mission ? teil(mission) : null, ziele: ziele.map(teil) };
}

/** The content of a section, null when the heading is missing. Ends at the next heading of the same or a higher level. */
export function abschnittInhalt(text: string, ueberschrift: string): string | null {
  const ebene = /^(#+)/.exec(ueberschrift.trim())?.[1].length ?? 2;
  let inhalt: string[] | null = null;
  for (const { z, code } of zeilenMitZaun(text)) {
    if (inhalt === null) {
      if (!code && z.trim() === ueberschrift.trim()) inhalt = [];
      continue;
    }
    const kopf = code ? null : /^(#+)\s/.exec(z);
    if (kopf && kopf[1].length <= ebene) break;
    inhalt.push(z);
  }
  return inhalt === null ? null : inhalt.join('\n');
}

/**
 * Checks every Missionsziel for the sections a run needs: acceptance and verification must be there
 * and not empty (without them /epic skips the Missionsziel). The modules section is optional, as in
 * /epic; its absence is only a note. Returns the notes, throws with every gap at once.
 */
export function pruefen(e: Entwurf, r: AuftragsRegeln): string[] {
  const fehler: string[] = [];
  const hinweise: string[] = [];
  const voll = (text: string, k: string) => (abschnittInhalt(text, k) ?? '').trim() !== '';
  for (const z of e.ziele) {
    const fehlt: string[] = [];
    if (!r.acceptance_section.some((k) => voll(z.text, k))) fehlt.push(r.acceptance_section.map((k) => `\`${k}\``).join(' oder '));
    if (!voll(z.text, r.verification_section)) fehlt.push(`\`${r.verification_section}\``);
    if (fehlt.length) fehler.push(`Missionsziel „${z.titel}“: ${fehlt.join(' und ')} fehlt oder ist leer.`);
    if (abschnittInhalt(z.text, r.modules_section) === null) hinweise.push(`Missionsziel „${z.titel}“ ohne \`${r.modules_section}\`: der Außeneinsatz schätzt Kollisionen dann aus den Dateipfaden.`);
  }
  if (fehler.length) throw new Error(`Nichts angelegt, Pflichtabschnitte fehlen:\n- ${fehler.join('\n- ')}`);
  return hinweise;
}

export function labelsFuer(art: 'mission' | 'ziel', r: AuftragsRegeln, starten: boolean): string[] {
  const status = starten ? r.ready_label : TRIAGE_LABEL;
  return art === 'mission' ? [r.epic_label, status] : [status];
}

const nr = (n: number | null) => (n === null ? '#?' : `#${n}`);

/** The body of a mission: its text, the list of its Missionsziele in draft order, the order line (kept when the draft has one). */
export function missionBody(m: Teil, ziele: { titel: string; nummer: number | null }[]): string {
  const liste = ziele.map((z) => `- [ ] ${nr(z.nummer)} ${z.titel}`).join('\n');
  const reihenfolge = /^>\s*\*\*Reihenfolge:\*\*/m.test(m.text) ? '' : `\n\n${REIHENFOLGE_STANDARD}`;
  return `${m.text ? `${m.text}\n\n` : ''}## Missionsziele\n${liste}${reihenfolge}\n`;
}

/** The body of a Missionsziel: "Teil von #…" as its first line when it belongs to a mission. */
export function zielBody(z: Teil, mission: number | null | undefined): string {
  return `${mission === undefined ? '' : `Teil von ${nr(mission)}\n\n`}${z.text}\n`;
}

export interface Auftrag {
  starten: boolean;
  trocken: boolean;
}

/**
 * Checks the draft and, unless trocken, creates it: the mission first (its number goes into every
 * Missionsziel), then the Missionsziele in draft order, each linked, then the final mission body
 * with the numbers. A forge failure midway names what already exists, so nothing is lost silently.
 */
export async function auftragAusfuehren(text: string, r: AuftragsRegeln, forge: Forge, o: Auftrag) {
  const e = entwurfLesen(text);
  const hinweise = pruefen(e, r);
  const zielLabels = labelsFuer('ziel', r, o.starten);
  if (o.trocken) {
    return {
      trocken: true,
      mission: e.mission ? { titel: e.mission.titel, labels: labelsFuer('mission', r, o.starten), body: missionBody(e.mission, e.ziele.map((z) => ({ titel: z.titel, nummer: null }))) } : null,
      ziele: e.ziele.map((z) => ({ titel: z.titel, labels: zielLabels, body: zielBody(z, e.mission ? null : undefined) })),
      hinweise,
    };
  }
  const angelegt: string[] = [];
  const schritt = async <T>(was: string, f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (err) {
      const schon = angelegt.length ? `Schon angelegt: ${angelegt.join(', ')}` : 'Nichts angelegt.';
      throw new Error(`${was} gescheitert: ${(err as Error).message}\n${schon}`);
    }
  };
  let mission: (AngelegtesIssue & { titel: string }) | null = null;
  if (e.mission) {
    const m = e.mission;
    const neu = await schritt(`Mission „${m.titel}“ anlegen`, () =>
      forge.anlegen({ titel: m.titel, body: missionBody(m, e.ziele.map((z) => ({ titel: z.titel, nummer: null }))), labels: labelsFuer('mission', r, o.starten) }),
    );
    mission = { ...neu, titel: m.titel };
    angelegt.push(neu.url);
  }
  const ziele: (AngelegtesIssue & { titel: string })[] = [];
  for (const z of e.ziele) {
    const neu = await schritt(`Missionsziel „${z.titel}“ anlegen`, () => forge.anlegen({ titel: z.titel, body: zielBody(z, mission?.nummer), labels: zielLabels }));
    ziele.push({ ...neu, titel: z.titel });
    angelegt.push(neu.url);
    if (mission) await schritt(`Missionsziel ${nr(neu.nummer)} mit Mission ${nr(mission.nummer)} verknüpfen`, () => forge.verknuepfen(mission!.nummer, neu.nummer));
  }
  if (mission && e.mission) {
    const body = missionBody(e.mission, ziele);
    await schritt(`Liste der Missionsziele in Mission ${nr(mission.nummer)} schreiben`, () => forge.bodySetzen(mission!.nummer, body));
  }
  return { trocken: false, mission, ziele, labels: { mission: mission ? labelsFuer('mission', r, o.starten) : null, ziele: zielLabels }, hinweise };
}
