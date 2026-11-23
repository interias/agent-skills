// The learning loop after a merged epic (Sparpaket, package 6): a cheap model reads what the run
// left in the forge and proposes at most three lessons, each in the cheapest durable form. Nothing
// is applied: the proposals go as one comment to the collecting issue `lern_issue` of the adapter,
// and `flotte triage` decides each proposal like a ticket (#117, src/triage.ts). Without lern_issue the
// comment is only printed.
//
// Growth stays bounded: every proposal names what can go in exchange, every rule the loop gave
// birth to carries an id (`Lernschleife L<n>`), each loop says per id whether the rule applied in
// this run, and a rule that never applied in LERN_STREICHEN_NACH runs in a row is proposed for
// deletion - counted here, not by the model.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Aufrufer } from './aufruf.ts';

export const LERN_MAX = 3;
export const LERN_STREICHEN_NACH = 10;
const BELEG_MAX = 40_000;
const REGEL = /Lernschleife (L\d+)/g;
export const LERN_MARKE = '<!-- lernschleife -->';

export const FORMEN = ['test', 'adapterregel', 'skilltext', 'doku'] as const;

export interface Vorschlag {
  titel: string;
  beleg: string;
  form: (typeof FORMEN)[number];
  umsetzung: string;
  wegfallen: string;
}

export interface LernErgebnis {
  vorschlaege: Vorschlag[];
  gegriffen: { regel: string; ja: boolean }[];
}

export function lernSchema(regeln: string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['vorschlaege', 'gegriffen'],
    properties: {
      vorschlaege: {
        type: 'array',
        maxItems: LERN_MAX,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['titel', 'beleg', 'form', 'umsetzung', 'wegfallen'],
          properties: {
            titel: { type: 'string' },
            beleg: { type: 'string', description: 'Link oder Fundstelle aus dem Lauf (Kommentar, Commit, Befund), kein Zitat langer Texte' },
            form: { type: 'string', enum: [...FORMEN] },
            umsetzung: { type: 'string', description: 'wo genau, in einem Satz' },
            wegfallen: { type: 'string', description: 'was dafür entfallen kann, oder "nichts"' },
          },
        },
      },
      gegriffen: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['regel', 'ja'],
          properties: { regel: regeln.length ? { type: 'string', enum: regeln } : { type: 'string' }, ja: { type: 'boolean' } },
        },
      },
    },
  };
}

/** Ids of the rules the loop gave birth to, with the line they stand in, from adapter and skill texts. */
export function lernRegeln(texte: { datei: string; text: string }[]): { regel: string; datei: string; zeile: string }[] {
  const out = new Map<string, { regel: string; datei: string; zeile: string }>();
  for (const t of texte) {
    for (const zeile of t.text.split(/\r?\n/)) {
      for (const m of zeile.matchAll(REGEL)) if (!out.has(m[1])) out.set(m[1], { regel: m[1], datei: t.datei, zeile: zeile.trim().slice(0, 300) });
    }
  }
  return [...out.values()].sort((a, b) => Number(a.regel.slice(1)) - Number(b.regel.slice(1)));
}

/** The texts lernRegeln searches: the adapter of the repository and every SKILL.md and reference of the skills. */
export function regelTexte(repo: string, skills: string | null): { datei: string; text: string }[] {
  const out: { datei: string; text: string }[] = [];
  const adapter = join(repo, '.claude', 'epic.md');
  if (existsSync(adapter)) out.push({ datei: '.claude/epic.md', text: readFileSync(adapter, 'utf8') });
  if (!skills || !existsSync(skills)) return out;
  for (const skill of readdirSync(skills)) {
    const dir = join(skills, skill);
    // an entry may vanish or be locked while it is read (another process cleaning up): skip it
    try {
      if (!statSync(dir).isDirectory()) continue;
      const dateien = ['SKILL.md', ...(existsSync(join(dir, 'references')) ? readdirSync(join(dir, 'references')).filter((n) => n.endsWith('.md')).map((n) => `references/${n}`) : [])];
      for (const d of dateien) if (existsSync(join(dir, d))) out.push({ datei: `${skill}/${d}`, text: readFileSync(join(dir, d), 'utf8') });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Per rule id the "applied" answers of earlier loops, oldest first, read from the comments of the
 * collecting issue (lines `Gegriffen: L1 ja, L2 nein`). A rule whose last n answers are all "nein"
 * is a candidate for deletion.
 */
export function streichKandidaten(kommentare: string[], n = LERN_STREICHEN_NACH): string[] {
  const verlauf = new Map<string, boolean[]>();
  for (const k of kommentare) {
    if (!k.includes(LERN_MARKE)) continue;
    const zeile = k.split(/\r?\n/).find((z) => z.startsWith('Gegriffen:'));
    if (!zeile) continue;
    for (const m of zeile.matchAll(/(L\d+) (ja|nein)/g)) {
      const v = verlauf.get(m[1]) ?? [];
      v.push(m[2] === 'ja');
      verlauf.set(m[1], v);
    }
  }
  return [...verlauf].filter(([, v]) => v.length >= n && v.slice(-n).every((x) => !x)).map(([r]) => r).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/** What the run left in the forge: the pull request and the comments of the epic, cut to BELEG_MAX. */
export function lernBeleg(a: Aufrufer, forge: string, pr: number, epic: number | null): string {
  const teile: string[] = [];
  const p = a('gh', ['pr', 'view', String(pr), '--repo', forge, '--json', 'number,title,url,body,mergedAt']);
  if (!p.code) {
    try {
      const j = JSON.parse(p.stdout);
      teile.push(`## Pull Request #${j.number}: ${j.title}\n${j.url}\ngemergt: ${j.mergedAt ?? 'nein'}\n\n${j.body ?? ''}`);
    } catch {
      teile.push(`## Pull Request #${pr}: nicht lesbar`);
    }
  } else teile.push(`## Pull Request #${pr}: nicht lesbar (${p.stderr.trim().slice(0, 200)})`);
  if (epic !== null) {
    const e = a('gh', ['issue', 'view', String(epic), '--repo', forge, '--json', 'number,title,url,comments']);
    if (!e.code) {
      try {
        const j = JSON.parse(e.stdout);
        teile.push(`## Mission #${j.number}: ${j.title}\n${j.url}`);
        for (const c of j.comments ?? []) teile.push(`### Kommentar ${c.url ?? ''} (${c.createdAt ?? ''})\n${c.body ?? ''}`);
      } catch {
        teile.push(`## Mission #${epic}: nicht lesbar`);
      }
    }
  }
  const text = teile.join('\n\n');
  return text.length > BELEG_MAX ? `${text.slice(0, BELEG_MAX)}\n\n[gekürzt nach ${BELEG_MAX} Zeichen]` : text;
}

export function lernAuftrag(beleg: string, regeln: { regel: string; datei: string; zeile: string }[], streichen: string[]): string {
  return `Du bist die Lernschleife nach einem angedockten Außeneinsatz (/mission). Du schlägst vor, du änderst nichts.

Lies den Beleg unten: Pull Request, Kommentare an der Mission (Zeiten-Zeilen, Befunde der Ersten Offiziere, Eskalationen, Rückgaben, offene Punkte).

Aufgabe 1 — höchstens ${LERN_MAX} Vorschläge, eher weniger. Nur aus einem Fehler, einer Wiederholung oder einer Verzögerung, die der Beleg zeigt. Für jeden:
- beleg: die Fundstelle im Lauf (Link des Kommentars, Commit, Befundnummer). Ohne Beleg kein Vorschlag.
- form: die billigste dauerhafte Form, in dieser Rangfolge: test (ein Test oder eine Lint-Regel, wirkt ohne Tokens) > adapterregel (ein Satz in .claude/epic.md des Projekts) > skilltext (ein Satz in einem Skill) > doku. Eine teurere Form nur, wenn die billigere nicht geht; sag in umsetzung, warum.
- Gegenfrage vor jedem Vorschlag: Würde ein künftiger Lauf den Fehler ohne diese Lehre wiederholen? Wenn nein, kein Vorschlag.
- wegfallen: was dafür entfallen kann (eine überholte Regel, ein Absatz), oder "nichts". Skills und Adapter dürfen nicht wachsen, ohne dass jemand das sieht.
Keine Vorschläge zu Geschmack, keine allgemeinen Ratschläge. Kein Vorschlag ist eine gültige Antwort.

Aufgabe 2 — gegriffen: Für jede Regel aus der Liste unten sag, ob sie in diesem Lauf gegriffen hat (ja: der Beleg zeigt, dass sie einen Fehler verhindert oder einen Schritt bestimmt hat; nein: sonst).
${regeln.length ? regeln.map((r) => `- ${r.regel} (${r.datei}): ${r.zeile}`).join('\n') : '(keine Regeln der Lernschleife vorhanden: gegriffen bleibt leer)'}
${streichen.length ? `\nHinweis: ${streichen.join(', ')} hat in den letzten ${LERN_STREICHEN_NACH} Läufen nie gegriffen und wird zum Streichen vorgeschlagen; das schreibt das Programm selbst dazu.\n` : ''}
Antworte nur über das Schema.

# Beleg

${beleg}`;
}

/** The comment for the collecting issue. New rules get the next free id; the person assigns it when adopting. */
export function lernKommentar(e: LernErgebnis, pr: number, epic: number | null, datum: string, regeln: string[], streichen: string[]): string {
  const zeilen = [LERN_MARKE, `**Lernschleife** — PR #${pr}${epic !== null ? `, Mission #${epic}` : ''}, ${datum}`, ''];
  if (!e.vorschlaege.length) zeilen.push('Keine Vorschläge: Der Lauf zeigt keinen Fehler, den eine dauerhafte Lehre verhindert hätte.');
  e.vorschlaege.slice(0, LERN_MAX).forEach((v, i) => {
    zeilen.push(`${i + 1}. **${v.titel}** — Form: ${v.form}`);
    zeilen.push(`   - Beleg: ${v.beleg}`);
    zeilen.push(`   - Umsetzung: ${v.umsetzung}`);
    zeilen.push(`   - Dafür entfällt: ${v.wegfallen}`);
  });
  const naechste = Math.max(0, ...regeln.map((r) => Number(r.slice(1)))) + 1;
  if (e.vorschlaege.length) zeilen.push('', `Übernimmst du einen Vorschlag als Regel, bekommt sie die Herkunft \`Lernschleife L${naechste}, ${datum}\` (fortlaufend). Nichts davon ist umgesetzt.`);
  const antworten = new Map(e.gegriffen.map((g) => [g.regel, g.ja]));
  if (regeln.length) zeilen.push('', `Gegriffen: ${regeln.map((r) => `${r} ${antworten.get(r) ? 'ja' : 'nein'}`).join(', ')}`);
  if (streichen.length) zeilen.push('', `**Zum Streichen vorgeschlagen:** ${streichen.join(', ')} — in den letzten ${LERN_STREICHEN_NACH} Läufen nie gegriffen.`);
  return zeilen.join('\n');
}

/** The structured output of the model, or null when it does not fit the schema. */
export function lernErgebnisAus(x: unknown): LernErgebnis | null {
  const o = x as Partial<LernErgebnis> | null;
  if (!o || !Array.isArray(o.vorschlaege) || !Array.isArray(o.gegriffen)) return null;
  const vorschlaege = o.vorschlaege.filter((v) => v && typeof v.titel === 'string' && typeof v.beleg === 'string' && v.beleg.trim() && FORMEN.includes(v.form as Vorschlag['form'])).slice(0, LERN_MAX);
  return { vorschlaege, gegriffen: o.gegriffen.filter((g) => g && typeof g.regel === 'string' && typeof g.ja === 'boolean') };
}

/** Comments of the collecting issue, for streichKandidaten. */
export function lernKommentare(a: Aufrufer, forge: string, issue: number): string[] {
  const r = a('gh', ['issue', 'view', String(issue), '--repo', forge, '--json', 'comments']);
  if (r.code) return [];
  try {
    return (JSON.parse(r.stdout).comments ?? []).map((c: { body?: string }) => String(c.body ?? ''));
  } catch {
    return [];
  }
}
