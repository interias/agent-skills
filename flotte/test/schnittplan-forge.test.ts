// #147: the cut plan goes into the forge. A clear note with a mission in the plan gets the comment with its
// origin first, then its missing sections appended (the original text stays character for character), then it
// hangs on its mission (a new one through the order writer, or an open one: sub-issue and `- [ ] #n` in its
// list), then Warp frei. A second run without new notes changes nothing, also after a step failed midway.

import { describe, expect, it } from 'vitest';
import { mitMissionszielen } from '../src/auftrag/auftrag.ts';
import { regelnAus } from '../src/befehle/auftrag.ts';
import { triagiere } from '../src/befehle/triage.ts';
import { lernKommentar } from '../src/lernen.ts';
import { abschlusspruefung } from '../src/triage-abschluss.ts';
import { entscheidungAus, offeneFragen, schnittplanAuftrag, type Ticket, TRIAGE_FRAGE_MARKE, TRIAGE_MARKE, wartetAufAntwort } from '../src/triage.ts';
import type { LaufErgebnis, Start } from '../src/werkzeuge/lauf.ts';

const REGELN = regelnAus('');
const KLAR = { entscheidung: 'klar', herkunft: 'Skill-Empfehlung', grund: 'Ziel und Prüfung sind klar.', fragen: [], abnahmekriterien: '- Es geht.', verifikationsweg: '`bun test`' };
const KRITISCH = {
  entscheidung: 'kritisch',
  herkunft: 'Skill-Empfehlung',
  grund: 'Geht nach außen.',
  fragen: [{ frage: 'Darf der Newsletter an alle gehen?', optionen: ['ja', 'nein'], antwort: 'nein', herkunft: 'Eigenes Urteil: nach außen', grund: 'nicht zurückholbar', beim_menschen: true, marke: 'nach außen' }],
  abnahmekriterien: '',
  verifikationsweg: '',
};

interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  comments: { body: string; login: string; rolle: string }[];
  kinder: number[];
  /** #149: the labels that were ever set on it (the `labeled` events of the forge) */
  markiert?: string[];
}
interface Aufruf {
  args: string[];
  eingabe?: string;
}

/** A forge with state: what one run writes, the next one reads. */
function forge(issues: Issue[]) {
  let naechste = 100;
  const finde = (n: number) => issues.find((i) => i.number === n)!;
  return {
    issues,
    finde,
    aufrufer(aufrufe: Aufruf[], scheitert: (args: string[]) => boolean = () => false) {
      return (_p: string, args: string[], opt?: { eingabe?: string }) => {
        aufrufe.push({ args, eingabe: opt?.eingabe });
        const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
        if (scheitert(args)) return { code: 1, stdout: '', stderr: 'HTTP 502' };
        const wert = (n: string) => args[args.indexOf(n) + 1];
        if (args[0] === 'issue' && args[1] === 'list') {
          const label = wert('--label');
          const liste = issues
            .filter((i) => i.state === 'open' && i.labels.includes(label))
            .map((i) => ({ number: i.number, title: i.title, body: i.body, url: `https://github.com/o/r/issues/${i.number}`, labels: i.labels.map((name) => ({ name })), comments: i.comments.map((c, j) => ({ body: c.body, author: { login: c.login }, authorAssociation: c.rolle, createdAt: `2026-11-22T10:0${j}:00Z` })) }));
          return ok(JSON.stringify(liste));
        }
        if (args[0] === 'api' && args.includes('--method')) {
          const m = Number(/issues\/(\d+)\/sub_issues$/.exec(args[3])![1]);
          finde(m).kinder.push(Number(wert('-F').split('=')[1]) - 1000);
          return ok('{}');
        }
        // #149: the jq of the run applied here: the `labeled` events of ready_label, the open children with it
        const lesen = /issues\/(\d+)\/(events|sub_issues)$/.exec(args[1] ?? '');
        if (args[0] === 'api' && lesen) {
          const i = finde(Number(lesen[1]));
          if (lesen[2] === 'events') return ok((i.markiert ?? []).filter((l) => l === 'ready-for-agent').map(() => '1\n').join(''));
          return ok(i.kinder.map((k) => issues.find((x) => x.number === k)).filter((k) => k && k.state === 'open' && k.labels.includes('ready-for-agent')).map((k) => `${k!.number}\n`).join(''));
        }
        // #147: the final check reads each note again: state, labels, comments, and its parent mission
        if (args[0] === 'issue' && args[1] === 'view') {
          const i = finde(Number(args[2]));
          return ok(JSON.stringify({ number: i.number, title: i.title, state: i.state.toUpperCase(), labels: i.labels.map((name) => ({ name })), comments: i.comments.map((c, j) => ({ body: c.body, author: { login: c.login }, authorAssociation: c.rolle, createdAt: `2026-11-22T11:0${j}:00Z`, url: `https://github.com/o/r/issues/${i.number}#issuecomment-${i.number * 10 + j}` })) }));
        }
        if (args[0] === 'api') {
          const nr = Number(/issues\/(\d+)$/.exec(args[1])![1]);
          const jq = wert('--jq');
          if (jq === '.parent_issue_url') {
            const eltern = issues.find((x) => x.kinder.includes(nr));
            return ok(eltern ? `https://api.github.com/repos/o/r/issues/${eltern.number}\n` : 'null\n');
          }
          if (jq === '.id') return ok(`${1000 + nr}\n`);
          if (jq === '.sub_issues_summary.total') return ok(`${finde(nr).kinder.length}\n`);
          return ok('OWNER\n');
        }
        if (args[0] === 'issue' && args[1] === 'comment') finde(Number(args[2])).comments.push({ body: opt!.eingabe!, login: 'flotte', rolle: 'OWNER' });
        if (args[0] === 'issue' && args[1] === 'edit') {
          const i = finde(Number(args[2]));
          if (args.includes('--body-file')) i.body = opt!.eingabe!;
          if (args.includes('--add-label')) {
            i.labels.push(wert('--add-label'));
            i.markiert = [...(i.markiert ?? []), wert('--add-label')];
          }
          if (args.includes('--remove-label')) i.labels = i.labels.filter((l) => !wert('--remove-label').split(',').includes(l));
        }
        if (args[0] === 'issue' && args[1] === 'close') finde(Number(args[2])).state = 'closed';
        if (args[0] === 'issue' && args[1] === 'create') {
          const n = naechste++;
          issues.push({ number: n, title: wert('--title'), body: opt!.eingabe!, labels: args.flatMap((x, i) => (x === '--label' ? [args[i + 1]] : [])), state: 'open', comments: [], kinder: [] });
          return ok(`https://github.com/o/r/issues/${n}\n`);
        }
        return ok();
      };
    },
  };
}

type Plan = (notizen: number[], auftrag: string) => unknown;
type Antworten = Record<number, unknown>;

/**
 * One run; the admiral answers each call with the plan, every note's place in it carrying the clearing of
 * antworten (fragen, abnahmekriterien, verifikationsweg). #146: geplant counts every start, no other call exists.
 * #147: abbrechen aborts during a call: that call and every later one end without an answer, like the real starte.
 */
async function lauf(f: ReturnType<typeof forge>, plan: Plan, antworten: Antworten, o: { trocken?: boolean; scheitert?: (args: string[]) => boolean; abbrechen?: (s: Start) => boolean; lernIssue?: number } = {}) {
  const aufrufe: Aufruf[] = [];
  const geplant: Start[] = [];
  let abgebrochen = -1;
  const r = await triagiere(
    { ziele: [{ repo: '.', forge: 'o/r', regeln: REGELN, lernIssue: o.lernIssue ?? null }], konto: 'k', modell: 'fable', trocken: o.trocken ?? false },
    {
      aufrufer: f.aufrufer(aufrufe, o.scheitert),
      abgebrochen: () => abgebrochen >= 0,
      starte: async (s: Start): Promise<LaufErgebnis> => {
        if (abgebrochen < 0 && o.abbrechen?.(s)) abgebrochen = aufrufe.length;
        if (abgebrochen >= 0) return { code: null, sitzung: null, dauerMs: 0, fehler: 'abbruch' } as unknown as LaufErgebnis;
        geplant.push(s);
        expect(s.auftrag.startsWith('FLOTTE-SCHNITTPLAN')).toBe(true);
        const nummern = [...s.auftrag.matchAll(/^## Sternzeit-Notiz #(\d+)/gm)].map((m) => Number(m[1]));
        const p = plan(nummern, s.auftrag) as { zuordnungen: { notiz: number }[] } | null;
        const klaerung = (n: number) => {
          const a = (antworten[n] ?? {}) as Record<string, unknown>;
          return { fragen: a.fragen ?? [], abnahmekriterien: a.abnahmekriterien ?? '', verifikationsweg: a.verifikationsweg ?? '' };
        };
        const strukturiert = p && { ...p, zuordnungen: p.zuordnungen.map((z) => ({ ...klaerung(z.notiz), ...z })) };
        return { code: 0, sitzung: `plan-${geplant.length}`, dauerMs: 1000, strukturiert } as LaufErgebnis;
      },
    },
  );
  return { r, aufrufe, geplant, abgebrochen };
}

const schreibend = (a: Aufruf[]) => a.filter((x) => (x.args[0] === 'issue' && ['edit', 'close', 'comment', 'create', 'delete'].includes(x.args[1])) || (x.args[0] === 'api' && x.args.includes('--method')) || x.args[0] === 'label');

/**
 * Every change of an issue that existed before the run has a comment with origin on that issue before it:
 * an edit or close on it, a sub-issue link on the mission and on the child. A mission created in this run is
 * created with its list and links (the comments at its notes name it first) and gets its comment right after.
 */
function jedeAenderungMitKommentar(a: Aufruf[], neu: Set<number>) {
  const kommentiert = new Set<number>();
  for (const x of a) {
    const pruefe = (nr: number, was: string) => {
      if (neu.has(nr)) return;
      expect(kommentiert.has(nr), `#${nr} ändert sich (${was}) ohne Kommentar mit Herkunft davor`).toBe(true);
    };
    if (x.args[0] === 'issue' && x.args[1] === 'comment') {
      if (/Herkunft: \S/.test(x.eingabe ?? '')) kommentiert.add(Number(x.args[2]));
    } else if (x.args[0] === 'issue' && ['edit', 'close'].includes(x.args[1])) pruefe(Number(x.args[2]), x.args[1]);
    else if (x.args[0] === 'api' && x.args.includes('--method')) {
      pruefe(Number(/issues\/(\d+)\/sub_issues$/.exec(x.args[3])![1]), 'Sub-Issue');
      pruefe(Number(x.args[x.args.indexOf('-F') + 1].split('=')[1]) - 1000, 'Sub-Issue');
    }
  }
}

const notiz = (number: number, title: string, body: string): Issue => ({ number, title, body, labels: ['needs-triage'], state: 'open', comments: [], kinder: [] });
const ORIGINAL_1 = 'Der Port soll vor dem Start geprüft werden.  \r\n\r\nMehr Text\t\r\n';
const ORIGINAL_2 = 'Auch beim Neustart.\n\n## Verifikationsweg\n\n## Betroffene Module\n- flotte/';
const MISSION_40 = 'Die Tafel verbessern.\n\n## Missionsziele\n- [ ] #30 Alte Tafel\n\n> **Reihenfolge:** von oben nach unten.\n';

function welt() {
  return forge([
    notiz(1, 'Port vor dem Start prüfen', ORIGINAL_1),
    notiz(2, 'Port beim Neustart', ORIGINAL_2),
    notiz(3, 'Tafel zeigt den Port', 'Die Tafel soll den Port zeigen.'),
    notiz(4, 'Logbuch-Idee', 'Vielleicht ein Filter.'),
    notiz(5, 'Newsletter zum Port', 'Ein Newsletter, wenn der Port belegt ist.'),
    { number: 40, title: 'Tafel', body: MISSION_40, labels: ['epic'], state: 'open', comments: [], kinder: [30] },
  ]);
}

const ZU: Record<number, object> = {
  1: { art: 'neue_mission', neue_mission: 'port' },
  2: { art: 'neue_mission', neue_mission: 'port' },
  3: { art: 'mission', mission: 40 },
  4: { art: 'triage' },
  5: { art: 'neue_mission', neue_mission: 'port' },
};
const PLAN: Plan = (nummern) => ({
  neue_missionen: nummern.some((n) => (ZU[n] as { neue_mission?: string }).neue_mission) ? [{ schluessel: 'port', titel: 'Portprüfung', begruendung: 'drei Notizen zum Port' }] : [],
  zuordnungen: nummern.map((n) => ({ notiz: n, grund: 'gleiches Thema', herkunft: 'Eigenes Urteil: Thema', ...ZU[n] })),
});
const ANTWORTEN: Antworten = { 1: KLAR, 2: KLAR, 3: KLAR, 4: KLAR, 5: KRITISCH };

describe('#147 Schnittplan in der Forge', () => {
  it('clear notes hang on their missions: comment, body supplemented, attached, Warp frei; every change has a comment before it', async () => {
    const f = welt();
    const { r, aufrufe } = await lauf(f, PLAN, ANTWORTEN);

    // the new mission through the order writer: only epic, the final list, its clear children linked; Warp frei
    // only after its first child is released
    const anlegen = aufrufe.filter((x) => x.args[0] === 'issue' && x.args[1] === 'create');
    expect(anlegen).toHaveLength(1);
    expect(anlegen[0].args).toEqual(['issue', 'create', '--repo', 'o/r', '--title', 'Portprüfung', '--label', 'epic', '--body-file', '-']);
    const port = f.finde(100);
    expect(port.labels).toEqual(['epic', 'ready-for-agent']);
    const frei = (nr: string) => aufrufe.findIndex((x) => x.args[1] === 'edit' && x.args[2] === nr && x.args.includes('--add-label'));
    expect(frei('1')).toBeLessThan(frei('100'));
    expect(port.body).toContain('drei Notizen zum Port');
    expect(port.body).toContain('## Missionsziele\n- [ ] #1 Port vor dem Start prüfen\n- [ ] #2 Port beim Neustart');
    expect(port.body).not.toContain('#5');
    expect(port.kinder).toEqual([1, 2]);
    // its comment with origin: title, reason, children, the note still waiting, the way back
    const [km] = port.comments;
    expect(port.comments).toHaveLength(1);
    expect(km.body).toContain(TRIAGE_MARKE);
    expect(km.body).toContain('Portprüfung');
    expect(km.body).toContain('drei Notizen zum Port');
    expect(km.body).toMatch(/#1 Port vor dem Start prüfen/);
    expect(km.body).toMatch(/#5 Newsletter zum Port/);
    expect(km.body).toMatch(/Herkunft: \S/);
    expect(km.body).toMatch(/Widerrufbar/);

    // the open mission: a comment, the new child linked and in its list, nothing of the old text lost
    const tafel = f.finde(40);
    expect(tafel.kinder).toEqual([30, 3]);
    expect(tafel.body).toBe('Die Tafel verbessern.\n\n## Missionsziele\n- [ ] #30 Alte Tafel\n- [ ] #3 Tafel zeigt den Port\n\n> **Reihenfolge:** von oben nach unten.\n');
    expect(tafel.comments).toHaveLength(1);
    expect(tafel.comments[0].body).toContain('#3 Tafel zeigt den Port');

    // the notes: Warp frei, triage label off, a comment naming the mission and what is added
    for (const n of [1, 2, 3]) {
      expect(f.finde(n).labels).toEqual(['ready-for-agent']);
      expect(f.finde(n).comments).toHaveLength(1);
    }
    expect(f.finde(1).comments[0].body).toContain('Portprüfung');
    expect(f.finde(1).comments[0].body).toContain('## Abnahmekriterien');
    expect(f.finde(3).comments[0].body).toContain('Mission #40');
    // the critical one: only its question, it stays in triage and is not in the mission
    expect(f.finde(5).labels).toEqual(['needs-triage']);
    expect(f.finde(5).comments.map((c) => c.body.split('\n')[0])).toEqual([TRIAGE_FRAGE_MARKE]);
    // the plan says triage without a question: the program asks one (#146), label and text stay
    expect(f.finde(4)).toMatchObject({ labels: ['needs-triage'], body: 'Vielleicht ein Filter.' });
    expect(f.finde(4).comments.map((c) => c.body.split('\n')[0])).toEqual([TRIAGE_FRAGE_MARKE]);

    jedeAenderungMitKommentar(aufrufe, new Set([100]));
    // the mission's comment comes right after its creation and its links, before any note is released
    const i = aufrufe.findIndex((x) => x.args[1] === 'comment' && x.args[2] === '100');
    expect(aufrufe.slice(0, i).some((x) => x.args.includes('--add-label') && ['1', '2'].includes(x.args[2]))).toBe(false);
    expect(aufrufe.some((x) => x.args.includes('delete'))).toBe(false);

    expect(r.tickets.map((t) => [t.nummer, t.ergebnis, t.geschrieben, t.mission, t.zuordnung])).toEqual([
      [1, 'klar', true, 100, 'neue_mission'],
      [2, 'klar', true, 100, 'neue_mission'],
      [3, 'klar', true, 40, 'mission'],
      [4, 'kritisch', true, undefined, 'triage'],
      [5, 'kritisch', true, undefined, 'neue_mission'],
    ]);
    const [p] = r.schnittplan;
    expect(p.neue_missionen).toEqual([expect.objectContaining({ schluessel: 'port', kinder: [1, 2, 5], nummer: 100, url: 'https://github.com/o/r/issues/100', angehaengt: [1, 2], geschrieben: true })]);
    expect(p.missionen).toEqual([expect.objectContaining({ nummer: 40, angehaengt: [3], geschrieben: true })]);
  });

  it('the original body stays complete, character for character: missing sections are appended, empty ones filled', async () => {
    const f = welt();
    await lauf(f, PLAN, ANTWORTEN);
    // missing: appended behind the untouched text (CRLF and trailing spaces kept)
    expect(f.finde(1).body.startsWith(ORIGINAL_1)).toBe(true);
    expect(f.finde(1).body.slice(ORIGINAL_1.length)).toBe('\n## Abnahmekriterien\n- Es geht.\n\n## Verifikationsweg\n`bun test`\n');
    // empty: the content below its heading; without it, the text is the original plus the appended section
    const zwei = f.finde(2).body.replace('## Verifikationsweg\n`bun test`\n', '## Verifikationsweg\n');
    expect(zwei).toBe(`${ORIGINAL_2}\n\n## Abnahmekriterien\n- Es geht.\n`);
    // the same with CRLF line ends in the note
    const crlf = 'Text\r\n\r\n## Verifikationsweg\r\n\r\n## Abnahmekriterien\r\n- schon da\r\n';
    const e = entscheidungAus(KLAR, 'T', crlf, REGELN);
    expect(e.art === 'klar' && e.body).toBe('Text\r\n\r\n## Verifikationsweg\r\n`bun test`\r\n\r\n## Abnahmekriterien\r\n- schon da\r\n');
    // a note with nothing to add is not edited
    const g = forge([notiz(7, 'Fertig', 'Text\n\n## Abnahmekriterien\n- a\n\n## Verifikationsweg\nb\n'), { number: 40, title: 'Tafel', body: MISSION_40, labels: ['epic'], state: 'open', comments: [], kinder: [] }]);
    const { aufrufe } = await lauf(g, () => ({ neue_missionen: [], zuordnungen: [{ notiz: 7, art: 'mission', mission: 40, grund: 'g', herkunft: 'h' }] }), { 7: KLAR });
    expect(aufrufe.filter((x) => x.args[1] === 'edit' && x.args[2] === '7' && x.args.includes('--body-file'))).toEqual([]);
    expect(g.finde(7).labels).toEqual(['ready-for-agent']);
  });

  it('a second run without new notes changes nothing: no mission, no comment, no label or body change', async () => {
    const f = welt();
    await lauf(f, PLAN, ANTWORTEN);
    const vorher = JSON.stringify(f.issues);
    const { aufrufe, r } = await lauf(f, PLAN, ANTWORTEN);
    expect(schreibend(aufrufe)).toEqual([]);
    expect(JSON.stringify(f.issues)).toBe(vorher);
    expect(r.tickets.map((t) => [t.nummer, t.ergebnis, t.geschrieben])).toEqual([[4, 'wartet', false], [5, 'wartet', false]]);
  });

  it('a note answered later goes to the open mission of the earlier run, not into a new one', async () => {
    const f = welt();
    await lauf(f, PLAN, ANTWORTEN);
    f.finde(5).comments.push({ body: 'Nur an die Testliste.', login: 'mensch', rolle: 'OWNER' });
    const plan2: Plan = (nummern) => ({ neue_missionen: [], zuordnungen: nummern.map((n) => (n === 5 ? { notiz: 5, art: 'mission', mission: 100, grund: 'Port', herkunft: 'Eigenes Urteil: Thema' } : { notiz: n, art: 'triage', grund: 'dünn', herkunft: 'x' })) });
    const { geplant, aufrufe } = await lauf(f, plan2, { ...ANTWORTEN, 5: KLAR });
    expect(geplant[0].auftrag).toContain('## Mission #100: Portprüfung (2 Kinder, noch 6 frei)');
    expect(geplant[0].auftrag).toMatch(/Vorrang/);
    expect(aufrufe.filter((x) => x.args[0] === 'issue' && x.args[1] === 'create')).toEqual([]);
    expect(f.finde(100).kinder).toEqual([1, 2, 5]);
    expect(f.finde(100).body).toContain('- [ ] #2 Port beim Neustart\n- [ ] #5 Newsletter zum Port');
    expect(f.finde(100).comments).toHaveLength(2);
    expect(f.finde(5).labels).toEqual(['ready-for-agent']);
    jedeAenderungMitKommentar(aufrufe, new Set());
  });

  it('a new mission is created only when one of its children is clear', async () => {
    const f = welt();
    const { r, aufrufe } = await lauf(f, PLAN, { ...ANTWORTEN, 1: KRITISCH, 2: KRITISCH });
    expect(aufrufe.filter((x) => x.args[0] === 'issue' && x.args[1] === 'create')).toEqual([]);
    expect(r.schnittplan[0].neue_missionen[0].nummer).toBeUndefined();
    expect(f.finde(1).labels).toEqual(['needs-triage']);
  });

  it('a step failing midway never repeats blindly: the next run neither creates nor comments twice', async () => {
    for (const scheitert of [
      (a: string[]) => a[0] === 'api' && a.includes('--method'), // linking
      (a: string[]) => a[0] === 'issue' && a[1] === 'create', // creating the mission
      (a: string[]) => a[1] === 'edit' && a.includes('--add-label'), // Warp frei
      (a: string[]) => a[1] === 'edit' && a.includes('--body-file'), // the body of a note or of the mission
      (a: string[]) => a[1] === 'comment' && ['40', '100'].includes(a[2]), // the comment at a mission
    ]) {
      const f = welt();
      const { r } = await lauf(f, PLAN, ANTWORTEN, { scheitert });
      expect(r.tickets.filter((t) => t.fehler).length).toBeGreaterThan(0);
      const vorher = JSON.stringify(f.issues);
      const { aufrufe, r: r2 } = await lauf(f, PLAN, ANTWORTEN);
      expect(schreibend(aufrufe)).toEqual([]);
      expect(JSON.stringify(f.issues)).toBe(vorher);
      expect(r2.tickets.filter((t) => [1, 2, 3].includes(t.nummer)).every((t) => t.ergebnis === 'wartet')).toBe(true);
    }
  });

  it('a new mission is released only with its first released child: not when its comment or the release of its children fails', async () => {
    const kommentarWeg = welt();
    const a = await lauf(kommentarWeg, PLAN, ANTWORTEN, { scheitert: (x) => x[1] === 'comment' && x[2] === '100' });
    expect(kommentarWeg.finde(100).labels).toEqual(['epic']);
    expect(kommentarWeg.finde(1).labels).toEqual(['needs-triage']);
    expect(a.r.schnittplan[0].neue_missionen[0]).toMatchObject({ nummer: 100, fehler: expect.stringContaining('Kommentar mit Herkunft gescheitert') });
    const freigabeWeg = welt();
    await lauf(freigabeWeg, PLAN, ANTWORTEN, { scheitert: (x) => x[1] === 'edit' && ['1', '2'].includes(x[2]) && x.includes('--add-label') });
    expect(freigabeWeg.finde(100).labels).toEqual(['epic']);
    expect(freigabeWeg.finde(100).comments).toHaveLength(1);
  });

  it('a link failing after the mission exists still names its number and url', async () => {
    const f = welt();
    const { r } = await lauf(f, PLAN, ANTWORTEN, { scheitert: (x) => x[0] === 'api' && x.includes('--method') && x[3].includes('/100/') });
    expect(r.schnittplan[0].neue_missionen[0]).toMatchObject({ nummer: 100, url: 'https://github.com/o/r/issues/100', fehler: expect.stringContaining('verknüpfen gescheitert') });
    expect(f.finde(100).labels).toEqual(['epic']);
  });

  it('a revoked note comes back into the same mission: no second link, no second entry in its list', async () => {
    const f = welt();
    await lauf(f, PLAN, ANTWORTEN);
    // the revocation over the bridge: ready_label off, needs-triage on, the objection as a comment
    const drei = f.finde(3);
    drei.labels = ['needs-triage'];
    drei.comments.push({ body: '**Widerruf des Menschen (Mensch über die Brücke)** — doch noch einmal ansehen\nHerkunft: Mensch über die Brücke', login: 'mensch', rolle: 'OWNER' });
    const nur3: Plan = (nummern) => ({ neue_missionen: [], zuordnungen: nummern.map((n) => (n === 3 ? { notiz: 3, art: 'mission', mission: 40, grund: 'Tafel', herkunft: 'h' } : { notiz: n, art: 'triage', grund: 'dünn', herkunft: 'x' })) });
    const { r, aufrufe } = await lauf(f, nur3, ANTWORTEN);
    expect(aufrufe.filter((x) => x.args.includes('--method'))).toEqual([]);
    expect(f.finde(40).kinder).toEqual([30, 3]);
    expect(f.finde(40).body.match(/#3 /g)).toHaveLength(1);
    expect(f.finde(3).labels).toEqual(['ready-for-agent']);
    expect(r.tickets.find((t) => t.nummer === 3)).toMatchObject({ geschrieben: true, mission: 40 });
    expect(r.tickets.find((t) => t.nummer === 3)?.fehler).toBeUndefined();
  });

  it('when the comment at a note fails, that note does not change and does not join the mission', async () => {
    const f = welt();
    const { r } = await lauf(f, PLAN, ANTWORTEN, { scheitert: (a) => a[1] === 'comment' && a[2] === '1' });
    expect(f.finde(1)).toMatchObject({ body: ORIGINAL_1, labels: ['needs-triage'] });
    expect(f.finde(100).kinder).toEqual([2]);
    expect(r.tickets[0]).toMatchObject({ nummer: 1, geschrieben: false, fehler: 'Kommentar gescheitert, nichts geändert' });
  });

  it('--trocken writes nothing and shows the new mission with its body and the supplemented note bodies', async () => {
    const f = welt();
    const vorher = JSON.stringify(f.issues);
    const { r, aufrufe } = await lauf(f, PLAN, ANTWORTEN, { trocken: true });
    expect(schreibend(aufrufe)).toEqual([]);
    expect(JSON.stringify(f.issues)).toBe(vorher);
    const [m] = r.schnittplan[0].neue_missionen;
    expect(m.labels).toEqual(['epic']);
    expect(m.body).toContain('- [ ] #1 Port vor dem Start prüfen\n- [ ] #2 Port beim Neustart');
    expect(m.kommentar).toContain('Portprüfung');
    expect(m.geschrieben).toBe(false);
    expect(r.schnittplan[0].missionen?.[0]).toMatchObject({ nummer: 40, geschrieben: false, body: expect.stringContaining('- [ ] #3 Tafel zeigt den Port') });
    const t1 = r.tickets.find((t) => t.nummer === 1)!;
    expect(t1.body?.startsWith(ORIGINAL_1)).toBe(true);
    expect(t1.kommentar).toContain('Portprüfung');
  });

  it('#149 a new mission whose own release failed is released by a later run: comment with origin first, then ready_label, once; --trocken only reports', async () => {
    const f = welt();
    const { r } = await lauf(f, PLAN, ANTWORTEN, { scheitert: (a) => a[1] === 'edit' && a[2] === '100' && a.includes('--add-label') });
    expect(f.finde(100).labels).toEqual(['epic']);
    expect(f.finde(1).labels).toEqual(['ready-for-agent']);
    expect(r.schnittplan[0].neue_missionen[0].fehler).toContain('Freigabe der Mission #100 gescheitert');
    expect(r.nachgeholt).toEqual([]);

    // --trocken: named in the output, nothing written
    const vorher = JSON.stringify(f.issues);
    const t = await lauf(f, PLAN, ANTWORTEN, { trocken: true });
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(JSON.stringify(f.issues)).toBe(vorher);
    expect(t.r.nachgeholt).toEqual([expect.objectContaining({ forge: 'o/r', nummer: 100, titel: 'Portprüfung', kinder: [1, 2], geschrieben: false, kommentar: expect.stringContaining('Herkunft: ') })]);

    const { r: r2, aufrufe } = await lauf(f, PLAN, ANTWORTEN);
    expect(f.finde(100).labels).toEqual(['epic', 'ready-for-agent']);
    expect(schreibend(aufrufe).map((x) => x.args.slice(0, 3))).toEqual([['issue', 'comment', '100'], ['issue', 'edit', '100']]);
    jedeAenderungMitKommentar(aufrufe, new Set());
    const [k] = f.finde(100).comments.slice(1);
    expect(k.body.split('\n')[0]).toBe(TRIAGE_MARKE);
    expect(k.body).toContain('#1, #2');
    expect(r2.nachgeholt).toEqual([expect.objectContaining({ nummer: 100, kinder: [1, 2], geschrieben: true })]);
    expect(r2.nachgeholt[0].fehler).toBeUndefined();

    // idempotent: the next run writes nothing
    const danach = JSON.stringify(f.issues);
    const r3 = await lauf(f, PLAN, ANTWORTEN);
    expect(schreibend(r3.aufrufe)).toEqual([]);
    expect(JSON.stringify(f.issues)).toBe(danach);
    expect(r3.r.nachgeholt).toEqual([]);
  });

  it('#149 the later release leaves alone: a mission of a person, one with an objection below, one that had ready_label once, one without a released child; a failed comment changes nothing', async () => {
    const mission = (number: number, mehr: Partial<Issue> = {}): Issue => ({ number, title: `Mission ${number}`, body: '## Missionsziele\n', labels: ['epic'], state: 'open', comments: [], kinder: [], ...mehr });
    const triage = { body: `${TRIAGE_MARKE}\n**Triage: Mission aus dem Schnittplan** — entschieden vom Admiral (\`flotte triage\`)\n\nHerkunft: x`, login: 'flotte', rolle: 'OWNER' };
    const frei = (number: number): Issue => ({ ...notiz(number, `Kind ${number}`, 'x'), labels: ['ready-for-agent'] });
    const f = forge([
      frei(1), frei(2), frei(3), frei(4), frei(5),
      { ...notiz(6, 'Kind 6', 'x'), labels: [] },
      // a person's mission: no comment of the triage, or only a stranger's copy of it
      mission(50, { kinder: [1] }),
      mission(51, { kinder: [2], comments: [{ ...triage, login: 'fremder', rolle: 'NONE' }] }),
      // an objection below the comment of the triage
      mission(52, { kinder: [3], comments: [triage, { body: 'Erst nach dem Release.', login: 'mensch', rolle: 'OWNER' }] }),
      // released once, a person took ready_label off
      mission(53, { kinder: [4], comments: [triage], markiert: ['ready-for-agent'] }),
      // no released open child
      mission(54, { kinder: [6], comments: [triage] }),
      // closed: revoked
      mission(55, { kinder: [5], comments: [triage], state: 'closed' }),
    ]);
    const vorher = JSON.stringify(f.issues);
    const { r, aufrufe } = await lauf(f, PLAN, {});
    expect(schreibend(aufrufe)).toEqual([]);
    expect(JSON.stringify(f.issues)).toBe(vorher);
    expect(r.nachgeholt).toEqual([]);

    // the comment fails: no label
    const g = forge([frei(1), mission(56, { kinder: [1], comments: [triage] })]);
    const { r: r2 } = await lauf(g, PLAN, {}, { scheitert: (a) => a[1] === 'comment' });
    expect(g.finde(56).labels).toEqual(['epic']);
    expect(r2.nachgeholt).toEqual([expect.objectContaining({ nummer: 56, geschrieben: false, fehler: 'Kommentar gescheitert, nichts geändert' })]);
  });
});

describe('#146 Ein Admiral-Aufruf je Projekt', () => {
  const THEMEN = ['Port', 'Tafel', 'Logbuch'];

  it('12 notes to 3 topics: exactly one admiral call; question, supplemented body, missions and closings all come from it', async () => {
    const f = forge([
      ...Array.from({ length: 12 }, (_, i) => notiz(i + 1, `${THEMEN[Math.floor(i / 4)]} ${i + 1}`, `Notiz ${i + 1}`)),
      { number: 40, title: 'Tafel', body: MISSION_40, labels: ['epic'], state: 'open', comments: [], kinder: [30] },
    ]);
    const zu: Record<number, object> = {
      1: { art: 'neue_mission', neue_mission: 'port' },
      2: { art: 'neue_mission', neue_mission: 'port' },
      3: { art: 'neue_mission', neue_mission: 'port' },
      4: { art: 'neue_mission', neue_mission: 'port' },
      5: { art: 'mission', mission: 40 },
      6: { art: 'mission', mission: 40 },
      7: { art: 'mission', mission: 40 },
      8: { art: 'zusammengefuehrt', in: 7 },
      9: { art: 'ueberfluessig', fundstelle: 'PR #12' },
      10: { art: 'neue_mission', neue_mission: 'logbuch' },
      11: { art: 'triage' },
      12: { art: 'verworfen' },
    };
    const plan: Plan = (nummern) => ({
      neue_missionen: [
        { schluessel: 'port', titel: 'Portprüfung', begruendung: 'vier Notizen zum Port' },
        { schluessel: 'logbuch', titel: 'Logbuch', begruendung: 'das Logbuch' },
      ],
      zuordnungen: nummern.map((n) => ({ notiz: n, grund: 'Thema', herkunft: 'Eigenes Urteil: Thema', ...zu[n] })),
    });
    const antworten: Antworten = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, i + 1 === 4 ? KRITISCH : KLAR]));
    const { r, geplant, aufrufe } = await lauf(f, plan, antworten);

    // the counting dummy: one start for all twelve, no call per note
    expect(geplant).toHaveLength(1);
    expect([...geplant[0].auftrag.matchAll(/^## Sternzeit-Notiz #(\d+)/gm)].map((m) => Number(m[1]))).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(r.schnittplan[0]).toMatchObject({ aufrufe: 1, sitzung: 'plan-1' });
    expect(r.schnittplan[0].pakete).toBeUndefined();

    expect(r.tickets.map((t) => [t.nummer, t.ergebnis, t.geschrieben, t.mission ?? null])).toEqual([
      [1, 'klar', true, 100], [2, 'klar', true, 100], [3, 'klar', true, 100], [4, 'kritisch', true, null],
      [5, 'klar', true, 40], [6, 'klar', true, 40], [7, 'klar', true, 40], [10, 'klar', true, 101], [11, 'kritisch', true, null],
    ]);
    expect(r.tickets.every((t) => t.sitzung === 'plan-1')).toBe(true);
    // the question: one comment in the form of the triage, read back for the Frachtraum
    expect(f.finde(4).comments.map((c) => c.body.split('\n')[0])).toEqual([TRIAGE_FRAGE_MARKE]);
    expect(f.finde(4).comments[0].body).toContain('Darf der Newsletter an alle gehen?');
    // #11 was left on triage without a question: the program's one comes second (#146)
    expect(r.fragen).toEqual([expect.objectContaining({ ticket: 4, frage: 'Darf der Newsletter an alle gehen?', marke: 'nach außen' }), expect.objectContaining({ ticket: 11, marke: 'zu dünn' })]);
    expect(f.finde(4).labels).toEqual(['needs-triage']);
    // the body supplemented, not replaced; the comment names what was added
    expect(f.finde(1).body).toBe('Notiz 1\n\n## Abnahmekriterien\n- Es geht.\n\n## Verifikationsweg\n`bun test`\n');
    expect(f.finde(1).comments[0].body).toContain('## Abnahmekriterien\n- Es geht.');
    expect(f.finde(1).labels).toEqual(['ready-for-agent']);
    // merged, superfluous, rejected: closed with their comment
    for (const n of [8, 9, 12]) expect(f.finde(n)).toMatchObject({ state: 'closed', comments: [expect.objectContaining({ body: expect.stringContaining(TRIAGE_MARKE) })] });
    expect(f.finde(11)).toMatchObject({ state: 'open', labels: ['needs-triage'], comments: [expect.objectContaining({ body: expect.stringContaining(TRIAGE_FRAGE_MARKE) })] });
    expect(f.finde(100).kinder).toEqual([1, 2, 3]);
    expect(f.finde(101).kinder).toEqual([10]);
    expect(f.finde(40).kinder).toEqual([30, 5, 6, 7]);
    jedeAenderungMitKommentar(aufrufe, new Set([100, 101]));
  });

  it('a note whose sections still fail after the repair stays on triage with its reason; the rest of the plan counts', async () => {
    const f = forge([
      notiz(1, 'Port vor dem Start', 'Text 1'),
      notiz(2, 'Port beim Neustart', 'Text 2'),
      notiz(3, 'Eigenes Thema', 'Text 3'),
      notiz(4, 'Tafel zeigt den Port', 'Text 4'),
      notiz(5, 'Alte Idee', 'Text 5'),
      { number: 40, title: 'Tafel', body: MISSION_40, labels: ['epic'], state: 'open', comments: [], kinder: [30] },
    ]);
    const zu: Record<number, object> = {
      1: { art: 'neue_mission', neue_mission: 'port' },
      2: { art: 'neue_mission', neue_mission: 'port' },
      3: { art: 'neue_mission', neue_mission: 'solo' },
      4: { art: 'mission', mission: 40 },
      5: { art: 'verworfen' },
    };
    const plan: Plan = (nummern) => ({
      neue_missionen: [
        { schluessel: 'port', titel: 'Portprüfung', begruendung: 'Port' },
        { schluessel: 'solo', titel: 'Solo', begruendung: 'eine Notiz' },
      ],
      zuordnungen: nummern.map((n) => ({ notiz: n, grund: 'Thema', herkunft: 'h', ...zu[n] })),
    });
    const OHNE = { ...KLAR, verifikationsweg: '' };
    // the repair answers the same plan again: the sections of #2, #3 and #4 still fail
    const { r, geplant, aufrufe } = await lauf(f, plan, { 1: KLAR, 2: OHNE, 3: OHNE, 4: OHNE, 5: KLAR });
    expect(geplant).toHaveLength(2);
    const [p] = r.schnittplan;
    expect(p.fehler).toBeUndefined();
    expect(p.reparatur?.fehler).toContain('Sternzeit-Notiz #2: abnahmekriterien oder verifikationsweg fehlt');
    // per note the reason and where it was to go
    const herab = (n: number) => p.zuordnungen.find((z) => z.notiz === n)!;
    expect(herab(2)).toMatchObject({ art: 'triage', herabgestuft: expect.stringContaining('vorgesehen: neue Mission „port“') });
    expect(herab(3)).toMatchObject({ art: 'triage', herabgestuft: expect.stringContaining('vorgesehen: neue Mission „solo“') });
    expect(herab(4)).toMatchObject({ art: 'triage', herabgestuft: expect.stringContaining('vorgesehen: Mission #40') });
    expect(herab(4).mission).toBeUndefined();
    expect(herab(1).herabgestuft).toBeUndefined();
    // it waits with a question to the person in the form of the triage (#147: an end state, no deviation)
    expect(r.tickets.find((t) => t.nummer === 2)).toMatchObject({ ergebnis: 'kritisch', geschrieben: true, zuordnung: 'triage', herabgestuft: expect.stringContaining('fehlt') });
    expect(r.fragen.map((x) => [x.ticket, x.optionen, x.empfehlung])).toEqual([
      [2, ['Abschnitte ergänzen, dann neue Mission „port“ zuordnen', 'verwerfen'], 'Abschnitte ergänzen, dann neue Mission „port“ zuordnen'],
      [3, ['Abschnitte ergänzen, dann neue Mission „solo“ zuordnen', 'verwerfen'], 'Abschnitte ergänzen, dann neue Mission „solo“ zuordnen'],
      [4, ['Abschnitte ergänzen, dann Mission #40 zuordnen', 'verwerfen'], 'Abschnitte ergänzen, dann Mission #40 zuordnen'],
    ]);
    for (const n of [2, 3, 4]) {
      const i = f.finde(n);
      expect(i.comments).toHaveLength(1);
      expect(i.comments[0].body.split('\n').slice(0, 2).join('\n')).toMatch(new RegExp(`^${TRIAGE_FRAGE_MARKE}\\n\\*\\*FRAGE AN DEN MENSCHEN \\(Triage\\)\\*\\* — Sternzeit-Notiz #${n}: `));
      expect(i.comments[0].body).toMatch(/Herkunft: \S/);
      const t: Ticket = { nummer: n, titel: i.title, body: i.body, url: '', labels: i.labels, kommentare: i.comments.map((c) => ({ body: c.body, autor: c.login, zeit: '2026-11-23T10:00:00Z', rolle: c.rolle })) };
      expect(wartetAufAntwort(t)).toBe(true);
      expect(offeneFragen(t)).toEqual([expect.objectContaining({ nr: 1, frage: expect.stringContaining('Verifikationsweg'), optionen: [expect.stringContaining('Abschnitte ergänzen'), 'verwerfen'], marke: 'Prüfung nicht bestanden' })]);
    }
    expect(f.finde(2).comments[0].body).toContain('war für neue Mission „port“ vorgesehen');
    // #147: the final check counts them clean (in triage with an open question)
    expect(r.abschluss.abweichungen.map((a) => a.nr).filter((n) => [2, 3, 4].includes(n))).toEqual([]);
    // the next run waits for the answer: no call for these notes, nothing written
    const zwei = await lauf(f, plan, { 1: KLAR, 2: OHNE, 3: OHNE, 4: OHNE, 5: KLAR });
    expect(zwei.geplant).toEqual([]);
    expect(zwei.r.tickets.filter((t) => [2, 3, 4].includes(t.nummer)).map((t) => t.ergebnis)).toEqual(['wartet', 'wartet', 'wartet']);
    // the new mission left without children is not created, the other one keeps only its good child
    expect(p.neue_missionen.map((m) => [m.schluessel, m.kinder])).toEqual([['port', [1]]]);
    expect(aufrufe.filter((x) => x.args[0] === 'issue' && x.args[1] === 'create')).toHaveLength(1);
    expect(f.finde(100).kinder).toEqual([1]);
    expect(f.finde(1).labels).toEqual(['ready-for-agent']);
    // the downgraded notes keep label and text, the open mission does not change; the rejected one is closed as planned
    for (const n of [2, 3, 4]) expect(f.finde(n)).toMatchObject({ labels: ['needs-triage'], body: `Text ${n}` });
    expect(f.finde(40).kinder).toEqual([30]);
    expect(f.finde(5).state).toBe('closed');
    jedeAenderungMitKommentar(aufrufe, new Set([100]));

    // --trocken writes nothing, the question stands in the output
    const g = forge([notiz(2, 'Port beim Neustart', 'Text 2'), { number: 40, title: 'Tafel', body: MISSION_40, labels: ['epic'], state: 'open', comments: [], kinder: [30] }]);
    const vorher = JSON.stringify(g.issues);
    const t = await lauf(g, () => ({ neue_missionen: [], zuordnungen: [{ notiz: 2, art: 'mission', mission: 40, grund: 'g', herkunft: 'h' }] }), { 2: OHNE }, { trocken: true });
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(JSON.stringify(g.issues)).toBe(vorher);
    expect(t.r.tickets).toEqual([expect.objectContaining({ nummer: 2, ergebnis: 'kritisch', geschrieben: false, kommentar: expect.stringContaining(TRIAGE_FRAGE_MARKE) })]);
    expect(t.r.fragen).toHaveLength(1);
  });

  it('#146 a note the plan leaves on triage without a question gets one from the program; one with its own question stays as it is', async () => {
    const mk = () => forge([notiz(1, 'Farben für die Themen', 'Welche Farbe welches Thema bekommt, weiß ich noch nicht.'), notiz(2, 'Port beim Neustart', 'Text 2')]);
    const frage = { frage: 'Welche Farbe?', optionen: ['blau', 'grün'], antwort: 'blau', herkunft: 'h', grund: 'g', beim_menschen: true, marke: 'zu dünn' };
    const plan: Plan = () => ({ neue_missionen: [], zuordnungen: [
      { notiz: 1, art: 'triage', grund: 'Zu dünn: die Zuordnung der Farben fehlt', herkunft: 'h', fragen: [] },
      { notiz: 2, art: 'triage', grund: 'g', herkunft: 'h', fragen: [frage] },
    ] });
    const f = mk();
    const { r } = await lauf(f, plan, {});
    const tick = (n: number): Ticket => { const i = f.finde(n); return { nummer: n, titel: i.title, body: i.body, url: '', labels: i.labels, kommentare: i.comments.map((c) => ({ body: c.body, autor: c.login, zeit: '2026-11-23T10:00:00Z', rolle: c.rolle })) }; };
    expect(f.finde(1).comments).toHaveLength(1);
    expect(f.finde(1).comments[0].body.startsWith(TRIAGE_FRAGE_MARKE)).toBe(true);
    expect(wartetAufAntwort(tick(1))).toBe(true);
    expect(offeneFragen(tick(1))).toEqual([expect.objectContaining({ nr: 1, marke: 'zu dünn', optionen: [expect.stringContaining('Notiz ergänzen'), 'verwerfen'] })]);
    expect(r.tickets.find((t) => t.nummer === 1)).toMatchObject({ ergebnis: 'kritisch', zuordnung: 'triage', fragenErgaenzt: true });
    // the model's own question: unchanged, nothing added
    expect(r.tickets.find((t) => t.nummer === 2)?.fragenErgaenzt).toBeUndefined();
    expect(offeneFragen(tick(2))).toEqual([expect.objectContaining({ frage: 'Welche Farbe?' })]);
    expect(r.abschluss.abweichungen).toEqual([]);
    // --trocken writes nothing
    const g = mk();
    const vorher = JSON.stringify(g.issues);
    const t = await lauf(g, plan, {}, { trocken: true });
    expect(schreibend(t.aufrufe)).toEqual([]);
    expect(JSON.stringify(g.issues)).toBe(vorher);
  });

  /** 30 long notes to 3 topics (two packages) and the open mission #40 with 5 free places */
  const teilungsForge = () =>
    forge([
      ...Array.from({ length: 30 }, (_, i) => notiz(i + 1, `${THEMEN[i % 3]} Notiz ${i + 1}`, 'x'.repeat(5_000))),
      { number: 40, title: 'Tafel', body: MISSION_40, labels: ['epic'], state: 'open', comments: [], kinder: [90, 91, 92] },
    ]);
  /**
   * The admiral keeps the limits the order names: the free places of #40 first, then a new mission per topic
   * (at most 8 children; with ueberlauf a full one gets a second of the same topic), the rest stays in triage.
   * Keys per package: schluessel(k), k counted from 1.
   */
  const teilungsPlan =
    (o: { ueberlauf?: boolean; schluessel?: (k: number) => string } = {}): Plan =>
    (nummern, auftrag) => {
      let neuMax = Number(/höchstens (\d+) neue Missionen/.exec(auftrag)![1]);
      let frei = Number(/## Mission #40: .*noch (\d+) frei/.exec(auftrag)?.[1] ?? 0);
      const neue: { schluessel: string; titel: string; begruendung: string }[] = [];
      const kinder = new Map<string, number>();
      const zuordnungen = nummern.map((n) => {
        const basis = { notiz: n, grund: 'Thema', herkunft: 'Eigenes Urteil: Thema' };
        if (frei-- > 0) return { ...basis, art: 'mission', mission: 40 };
        const thema = THEMEN[(n - 1) % 3];
        let m = neue.findLast((x) => x.titel === thema);
        const voll = m && (kinder.get(m.schluessel) ?? 0) >= 8;
        if ((!m || (voll && o.ueberlauf)) && neuMax-- > 0) neue.push((m = { schluessel: (o.schluessel ?? ((k) => `m${k}`))(neue.length + 1), titel: thema, begruendung: thema }));
        if (!m || (kinder.get(m.schluessel) ?? 0) >= 8) return { ...basis, art: 'triage' };
        kinder.set(m.schluessel, (kinder.get(m.schluessel) ?? 0) + 1);
        return { ...basis, art: 'neue_mission', neue_mission: m.schluessel };
      });
      return { neue_missionen: neue, zuordnungen };
    };
  const alleKlar = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, KLAR]));

  it('above the size limit: few packages by topic, one call each, never one per note; the limits hold over all packages', async () => {
    const f = teilungsForge();
    const { r, geplant } = await lauf(f, teilungsPlan(), alleKlar);

    expect(geplant).toHaveLength(2);
    const notizenIn = (s: Start) => [...s.auftrag.matchAll(/^## Sternzeit-Notiz #(\d+): (\w+)/gm)].map((m) => m[2]);
    // whole topics per package: two together, the third alone
    for (const thema of THEMEN) expect(geplant.filter((s) => notizenIn(s).includes(thema))).toHaveLength(1);
    expect(geplant.map((s) => notizenIn(s).length)).toEqual([20, 10]);
    const allein = notizenIn(geplant[1])[0];
    expect(notizenIn(geplant[1])).toEqual(Array(10).fill(allein));
    // the second package gets what the first left: #40 full, two of four new missions
    expect(geplant[1].auftrag).toContain('## Mission #40: Tafel (8 Kinder, voll, keine neuen Kinder)');
    expect(geplant[1].auftrag).toContain('höchstens 2 neue Missionen');
    const [p] = r.schnittplan;
    expect(p.fehler).toBeUndefined();
    expect(p.aufrufe).toBe(2);
    expect(p.pakete?.map((x) => [x.notizen.length, x.sitzung])).toEqual([[20, 'plan-1'], [10, 'plan-2']]);
    // a key of the first package stays its own
    expect(p.neue_missionen.map((m) => m.schluessel)).toEqual(['m1', 'm2', 'm1-2']);
    expect(p.neue_missionen[2].titel).toBe(allein);
    expect(p.neue_missionen.length).toBeLessThanOrEqual(4);
    expect(p.neue_missionen.every((m) => m.kinder.length <= 8)).toBe(true);
    expect(f.finde(40).kinder).toHaveLength(8);
    // the mission of the third topic got its own notes, not those of m1 in the first package
    const dritte = f.issues.find((i) => i.labels.includes('epic') && i.title === allein && i.number >= 100)!;
    expect(dritte.kinder).toHaveLength(8);
    expect(dritte.kinder.every((n) => THEMEN[(n - 1) % 3] === allein)).toBe(true);
  });

  it('a renamed key never takes the key of another mission of the same package', async () => {
    // both packages name their missions m1 and m1-2: the renamed m1 of the second must skip its own m1-2 as well
    const f = teilungsForge();
    const { r } = await lauf(f, teilungsPlan({ ueberlauf: true, schluessel: (k) => (k === 1 ? 'm1' : 'm1-2') }), alleKlar);
    const [p] = r.schnittplan;
    expect(p.fehler).toBeUndefined();
    expect(p.neue_missionen.map((m) => [m.schluessel, m.kinder.length])).toEqual([['m1', 8], ['m1-2', 7], ['m1-2-2', 8], ['m1-2-2-2', 2]]);
    const schluessel = p.neue_missionen.map((m) => m.schluessel);
    expect(new Set(schluessel).size).toBe(schluessel.length);
    // each note hangs on the mission of its own package: the four missions carry 8 + 7 + 8 + 2 notes, no note twice
    const missionen = f.issues.filter((i) => i.number >= 100);
    expect(missionen.map((m) => m.kinder.length).sort((a, b) => a - b)).toEqual([2, 7, 8, 8]);
    expect(new Set(missionen.flatMap((m) => m.kinder)).size).toBe(25);
  });
});

describe('#147 Schnittplan: freie Plätze und Reparaturrunde', () => {
  const VOLL = (kinder: number[]): Issue => ({ number: 40, title: 'Tafel', body: MISSION_40, labels: ['epic'], state: 'open', comments: [], kinder });
  const ZWEI = () => forge([notiz(1, 'A', 'a'), notiz(2, 'B', 'b'), VOLL([30, 31, 32, 33, 34, 35, 36])]);
  const ZU_VIEL = { neue_missionen: [], zuordnungen: [1, 2].map((n) => ({ notiz: n, art: 'mission', mission: 40, grund: 'g', herkunft: 'h' })) };
  const RICHTIG = { neue_missionen: [], zuordnungen: [{ notiz: 1, art: 'mission', mission: 40, grund: 'g', herkunft: 'h' }, { notiz: 2, art: 'triage', grund: 'kein Platz', herkunft: 'h' }] };

  it('names the free places of every open mission, a full one as full', () => {
    const t = (n: number) => ({ nummer: n, titel: 'N', body: '', url: '', labels: [], kommentare: [] });
    const a = schnittplanAuftrag([t(1)], [{ nummer: 40, titel: 'Tafel', body: '', kinder: 7 }, { nummer: 41, titel: 'Voll', body: '', kinder: 8 }], REGELN);
    expect(a).toContain('## Mission #40: Tafel (7 Kinder, noch 1 frei)');
    expect(a).toContain('## Mission #41: Voll (8 Kinder, voll, keine neuen Kinder)');
  });

  it('an invalid plan gets exactly one repair call with the error and the answer; a valid repair counts', async () => {
    const f = ZWEI();
    const { r, geplant } = await lauf(f, (_n, auftrag) => (auftrag.includes('Korrektur') ? RICHTIG : ZU_VIEL), { 1: KLAR, 2: KLAR });
    expect(geplant).toHaveLength(2);
    expect(geplant[1].auftrag.startsWith(geplant[0].auftrag)).toBe(true);
    expect(geplant[1].auftrag).toContain('Mission #40 hätte mehr als 8 Kinder (7 + 2)');
    expect(geplant[1].auftrag).toContain('Deine Antwort war:\n{"neue_missionen":[],"zuordnungen":[{');
    expect(geplant[1].auftrag).toContain('"notiz":2,"art":"mission","mission":40');
    const [p] = r.schnittplan;
    expect(p.fehler).toBeUndefined();
    expect(p.sitzung).toBe('plan-2');
    expect(p.reparatur).toEqual({ sitzung: 'plan-1', fehler: 'Mission #40 hätte mehr als 8 Kinder (7 + 2)' });
    expect(f.finde(40).kinder).toHaveLength(8);
  });

  it('a failed repair writes nothing; the repair is the only second call', async () => {
    const f = ZWEI();
    const vorher = JSON.stringify(f.issues);
    const { r, geplant, aufrufe } = await lauf(f, () => ZU_VIEL, { 1: KLAR, 2: KLAR });
    expect(geplant).toHaveLength(2);
    expect(r.schnittplan[0].aufrufe).toBe(2);
    expect(schreibend(aufrufe)).toEqual([]);
    expect(JSON.stringify(f.issues)).toBe(vorher);
    expect(r.schnittplan[0].fehler).toContain('hätte mehr als 8 Kinder');
    expect(r.schnittplan[0].reparatur?.sitzung).toBe('plan-1');
  });

  it('an answer outside the schema (the call failed) gets no repair', async () => {
    const { r, geplant } = await lauf(ZWEI(), () => null, {});
    expect(geplant).toHaveLength(1);
    expect(r.schnittplan[0].fehler).toContain('Schema');
    expect(r.schnittplan[0].reparatur).toBeUndefined();
  });

  it('the list of a mission gets a new child once, below the last one, or a new list when it has none', () => {
    expect(mitMissionszielen(MISSION_40, [{ nummer: 30, titel: 'Alte Tafel' }])).toBe(MISSION_40);
    expect(mitMissionszielen('Text', [{ nummer: 3, titel: 'T' }])).toBe('Text\n\n## Missionsziele\n- [ ] #3 T\n');
    expect(mitMissionszielen('Text\n\n## Missionsziele\n\nmehr', [{ nummer: 3, titel: 'T' }])).toBe('Text\n\n## Missionsziele\n- [ ] #3 T\n\nmehr');
  });
});

describe('#147 Abschlussprüfung: jede Notiz der Eingabe endet in einem erlaubten Zustand', () => {
  const READY = 'ready-for-agent';
  const nr = (r: { abschluss: { abweichungen: { nr: number }[] } }) => r.abschluss.abweichungen.map((a) => a.nr);

  it('after the run no note carries ready_label without hanging on a mission; every child and every new mission carries it', async () => {
    const f = welt();
    const { r, aufrufe } = await lauf(f, PLAN, ANTWORTEN);
    // the forge is read again after writing, per note of the input
    expect(aufrufe.filter((x) => x.args[0] === 'issue' && x.args[1] === 'view').map((x) => x.args[2])).toEqual(['1', '100', '2', '3', '40', '4', '5']);
    for (const n of [1, 2, 3]) expect(f.finde(n).labels).toContain(READY);
    expect(f.finde(100).labels).toContain(READY);
    const freigegeben = f.issues.filter((i) => i.state === 'open' && i.labels.includes(READY) && !i.labels.includes('epic'));
    for (const i of freigegeben) expect(f.issues.some((m) => m.labels.includes('epic') && m.state === 'open' && m.kinder.includes(i.number))).toBe(true);
    // 1, 2 (new mission 100), 3 (mission 40) released, 5 asked, 4 left on triage by the plan and asked by the program (#146): all clean
    expect(r.abschluss).toMatchObject({ geprueft: 5, sauber: 5, abweichungen: [] });
    expect(r.zustand).toBe('beendet');
    // the check itself still reports a note in triage without an open question
    f.finde(4).comments = [];
    expect(abschlusspruefung(f.aufrufer([]), 'o/r', REGELN, [{ nummer: 4, titel: 'Logbuch-Idee' }], [])).toEqual([{ forge: 'o/r', nr: 4, titel: 'Logbuch-Idee', zustand: 'offen, needs-triage', grund: 'in der Triage ohne offene Frage an den Menschen' }]);
  });

  it('reports a note without an allowed end state as an error: ready without mission, child of a new mission without ready, closed without reason', async () => {
    // the mission's own release fails: its released children hang on a mission without Warp frei
    const f = welt();
    const { r } = await lauf(f, PLAN, ANTWORTEN, { scheitert: (a) => a[1] === 'edit' && a[2] === '100' && a.includes('--add-label') });
    expect(nr(r)).toEqual([1, 2]);
    expect(r.abschluss.abweichungen[0]).toMatchObject({ zustand: `offen, ${READY}, Kind von #100`, grund: `Mission #100 ist neu und trägt kein ${READY}` });

    // a lost link and a closing without reason, read by the check itself
    const g = welt();
    await lauf(g, PLAN, ANTWORTEN);
    g.finde(40).kinder = [30];
    g.finde(5).state = 'closed';
    g.finde(5).comments = [];
    const abw = abschlusspruefung(g.aufrufer([]), 'o/r', REGELN, [g.finde(3), g.finde(5)].map((i) => ({ nummer: i.number, titel: i.title })), []);
    expect(abw).toEqual([
      { forge: 'o/r', nr: 3, titel: 'Tafel zeigt den Port', zustand: `offen, ${READY}`, grund: `${READY} ohne Mission (kein Sub-Issue einer Mission)` },
      { forge: 'o/r', nr: 5, titel: 'Newsletter zum Port', zustand: 'geschlossen', grund: 'geschlossen ohne Grund im letzten Kommentar der Triage' },
    ]);
  });

  it('closed with a reason (merged, superfluous, rejected) and asked notes are clean; a clean run is beendet', async () => {
    const f = forge([notiz(1, 'A', 'a'), notiz(2, 'B', 'b'), notiz(3, 'C', 'c'), notiz(4, 'D', 'd')]);
    const plan: Plan = () => ({
      neue_missionen: [],
      zuordnungen: [
        { notiz: 1, art: 'zusammengefuehrt', in: 4, grund: 'dasselbe', herkunft: 'h' },
        { notiz: 2, art: 'ueberfluessig', grund: 'erledigt', fundstelle: '#9', herkunft: 'h' },
        { notiz: 3, art: 'verworfen', grund: 'passt nicht', herkunft: 'h' },
        { notiz: 4, art: 'triage', grund: 'Frage', herkunft: 'h' },
      ],
    });
    const { r } = await lauf(f, plan, { 4: KRITISCH });
    expect(r.abschluss).toEqual({ geprueft: 4, sauber: 4, abweichungen: [] });
    expect(r.zustand).toBe('beendet');
  });

  it('--trocken: no final check against the forge, the output says it is left out', async () => {
    const { r, aufrufe } = await lauf(welt(), PLAN, ANTWORTEN, { trocken: true });
    expect(aufrufe.some((x) => x.args[1] === 'view' || x.args.includes('.parent_issue_url'))).toBe(false);
    expect(r.abschluss).toEqual({ geprueft: 0, sauber: 0, abweichungen: [], entfaellt: 'trocken: nichts geschrieben, keine Abschlussprüfung' });
    expect(r.zustand).toBe('beendet');
  });
});

describe('#147 Abbruch mitten im Lauf: danach schreibt triagiere nichts mehr, das bis dahin Geschriebene steht im Ergebnis', () => {
  const PLAN_MIT_ZU: Plan = (nummern) => ({ ...(PLAN(nummern, '') as object), zuordnungen: (PLAN(nummern, '') as { zuordnungen: { notiz: number }[] }).zuordnungen.map((z) => (z.notiz === 4 ? { notiz: 4, art: 'verworfen', grund: 'passt nicht', herkunft: 'h' } : z)) });

  it('aborted after the one admiral call, in the call for a learning proposal: what the plan wrote stands in the output, nothing is written after it, no final check', async () => {
    const f = welt();
    const lern = lernKommentar({ vorschlaege: [{ titel: 'Typprüfung im Gate', beleg: 'PR #10', form: 'test', umsetzung: 'tsc im Gate', wegfallen: 'nichts' }], gegriffen: [] }, 10, 9, '2026-11-22', [], []);
    f.issues.push({ number: 119, title: 'Lernschleife', body: '', labels: [], state: 'open', comments: [{ body: lern, login: 'flotte', rolle: 'OWNER' }], kinder: [] });
    const { r, aufrufe, abgebrochen, geplant } = await lauf(f, PLAN_MIT_ZU, ANTWORTEN, { lernIssue: 119, abbrechen: (s) => !s.auftrag.startsWith('FLOTTE-SCHNITTPLAN') });
    expect(geplant).toHaveLength(1);
    expect(abgebrochen).toBeGreaterThan(0);
    expect(schreibend(aufrufe.slice(abgebrochen))).toEqual([]);
    expect(aufrufe.slice(abgebrochen).some((x) => x.args[1] === 'view' && x.args[2] !== '119')).toBe(false);
    // written before the abort: #4 closed, the new mission with its released children, all in the output
    expect(f.finde(4).state).toBe('closed');
    expect(r.schnittplan[0].zuordnungen.find((z) => z.notiz === 4)).toMatchObject({ geschrieben: true });
    expect(f.finde(100).labels).toContain('ready-for-agent');
    expect(r.schnittplan[0].neue_missionen[0]).toMatchObject({ nummer: 100, geschrieben: true });
    expect(r.tickets.filter((t) => t.mission === 100).map((t) => t.nummer)).toEqual([1, 2]);
    // the proposal: no comment at the collecting issue
    expect(f.finde(119).comments).toHaveLength(1);
    expect(r.zustand).toBe('abgebrochen');
    expect(r.abschluss).toMatchObject({ geprueft: 0, abweichungen: [], entfaellt: expect.stringContaining('abgebrochen') });
  });

  it('aborted in the cut plan call: nothing written at all', async () => {
    const f = welt();
    const vorher = JSON.stringify(f.issues);
    const { r, aufrufe } = await lauf(f, PLAN_MIT_ZU, ANTWORTEN, { abbrechen: (s) => s.auftrag.startsWith('FLOTTE-SCHNITTPLAN') });
    expect(schreibend(aufrufe)).toEqual([]);
    expect(JSON.stringify(f.issues)).toBe(vorher);
    expect(r.zustand).toBe('abgebrochen');
  });
});
