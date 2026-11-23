// #147: the cut plan goes into the forge. A clear note with a mission in the plan gets the comment with its
// origin first, then its missing sections appended (the original text stays character for character), then it
// hangs on its mission (a new one through the order writer, or an open one: sub-issue and `- [ ] #n` in its
// list), then Warp frei. A second run without new notes changes nothing, also after a step failed midway.

import { describe, expect, it } from 'vitest';
import { mitMissionszielen } from '../src/auftrag/auftrag.ts';
import { regelnAus } from '../src/befehle/auftrag.ts';
import { triagiere } from '../src/befehle/triage.ts';
import { abschlusspruefung } from '../src/triage-abschluss.ts';
import { entscheidungAus, schnittplanAuftrag, TRIAGE_FRAGE_MARKE, TRIAGE_MARKE } from '../src/triage.ts';
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
          return ok(JSON.stringify({ number: i.number, title: i.title, state: i.state.toUpperCase(), labels: i.labels.map((name) => ({ name })), comments: i.comments.map((c, j) => ({ body: c.body, author: { login: c.login }, authorAssociation: c.rolle, createdAt: `2026-11-22T11:0${j}:00Z` })) }));
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

async function lauf(f: ReturnType<typeof forge>, plan: Plan, antworten: Antworten, o: { trocken?: boolean; scheitert?: (args: string[]) => boolean } = {}) {
  const aufrufe: Aufruf[] = [];
  const geplant: Start[] = [];
  const einzeln: Start[] = [];
  const r = await triagiere(
    { ziele: [{ repo: '.', forge: 'o/r', regeln: REGELN }], konto: 'k', modell: 'fable', trocken: o.trocken ?? false },
    {
      aufrufer: f.aufrufer(aufrufe, o.scheitert),
      starte: async (s: Start): Promise<LaufErgebnis> => {
        if (s.auftrag.startsWith('FLOTTE-SCHNITTPLAN')) {
          geplant.push(s);
          const nummern = [...s.auftrag.matchAll(/^## Sternzeit-Notiz #(\d+)/gm)].map((m) => Number(m[1]));
          return { code: 0, sitzung: `plan-${geplant.length}`, dauerMs: 1000, strukturiert: plan(nummern, s.auftrag) } as LaufErgebnis;
        }
        einzeln.push(s);
        const nr = Number(/Sternzeit-Notiz #(\d+)/.exec(s.auftrag)?.[1]);
        return { code: 0, sitzung: 's', dauerMs: 1000, strukturiert: antworten[nr] } as LaufErgebnis;
      },
    },
  );
  return { r, aufrufe, geplant, einzeln };
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
    // the plan says triage: clear, but not released on its own, nothing written
    expect(f.finde(4)).toMatchObject({ labels: ['needs-triage'], comments: [], body: 'Vielleicht ein Filter.' });

    jedeAenderungMitKommentar(aufrufe, new Set([100]));
    // the mission's comment comes right after its creation and its links, before any note is released
    const i = aufrufe.findIndex((x) => x.args[1] === 'comment' && x.args[2] === '100');
    expect(aufrufe.slice(0, i).some((x) => x.args.includes('--add-label') && ['1', '2'].includes(x.args[2]))).toBe(false);
    expect(aufrufe.some((x) => x.args.includes('delete'))).toBe(false);

    expect(r.tickets.map((t) => [t.nummer, t.ergebnis, t.geschrieben, t.mission, t.zuordnung])).toEqual([
      [1, 'klar', true, 100, 'neue_mission'],
      [2, 'klar', true, 100, 'neue_mission'],
      [3, 'klar', true, 40, 'mission'],
      [4, 'klar', false, undefined, 'triage'],
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
    expect(r.tickets.map((t) => [t.nummer, t.ergebnis, t.geschrieben])).toEqual([[5, 'wartet', false], [4, 'klar', false]]);
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

describe('#147 Schnittplan: freie Plätze und Reparaturrunde', () => {
  const VOLL = (kinder: number[]): Issue => ({ number: 40, title: 'Tafel', body: MISSION_40, labels: ['epic'], state: 'open', comments: [], kinder });
  const ZWEI = () => forge([notiz(1, 'A', 'a'), notiz(2, 'B', 'b'), VOLL([30, 31, 32, 33, 34, 35, 36])]);
  const ZU_VIEL = { neue_missionen: [], zuordnungen: [1, 2].map((n) => ({ notiz: n, art: 'mission', mission: 40, grund: 'g', herkunft: 'h' })) };
  const RICHTIG = { neue_missionen: [], zuordnungen: [{ notiz: 1, art: 'mission', mission: 40, grund: 'g', herkunft: 'h' }, { notiz: 2, art: 'triage', grund: 'kein Platz', herkunft: 'h' }] };

  it('names the free places of every open mission, a full one as full', () => {
    const t = (n: number) => ({ nummer: n, titel: 'N', body: '', url: '', labels: [], kommentare: [] });
    const a = schnittplanAuftrag([t(1)], [{ nummer: 40, titel: 'Tafel', body: '', kinder: 7 }, { nummer: 41, titel: 'Voll', body: '', kinder: 8 }]);
    expect(a).toContain('## Mission #40: Tafel (7 Kinder, noch 1 frei)');
    expect(a).toContain('## Mission #41: Voll (8 Kinder, voll, keine neuen Kinder)');
  });

  it('an invalid plan gets exactly one repair call with the error and the answer; a valid repair counts', async () => {
    const f = ZWEI();
    const { r, geplant } = await lauf(f, (_n, auftrag) => (auftrag.includes('Korrektur') ? RICHTIG : ZU_VIEL), { 1: KLAR, 2: KLAR });
    expect(geplant).toHaveLength(2);
    expect(geplant[1].auftrag.startsWith(geplant[0].auftrag)).toBe(true);
    expect(geplant[1].auftrag).toContain('Mission #40 hätte mehr als 8 Kinder (7 + 2)');
    expect(geplant[1].auftrag).toContain(JSON.stringify(ZU_VIEL));
    const [p] = r.schnittplan;
    expect(p.fehler).toBeUndefined();
    expect(p.sitzung).toBe('plan-2');
    expect(p.reparatur).toEqual({ sitzung: 'plan-1', fehler: 'Mission #40 hätte mehr als 8 Kinder (7 + 2)' });
    expect(f.finde(40).kinder).toHaveLength(8);
  });

  it('a failed repair writes nothing and runs no single clearing', async () => {
    const f = ZWEI();
    const vorher = JSON.stringify(f.issues);
    const { r, geplant, einzeln, aufrufe } = await lauf(f, () => ZU_VIEL, { 1: KLAR, 2: KLAR });
    expect(geplant).toHaveLength(2);
    expect(einzeln).toEqual([]);
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
    // 1, 2 (new mission 100), 3 (mission 40) released, 5 asked: clean; 4 left in triage by the plan without a question
    expect(r.abschluss).toMatchObject({ geprueft: 5, sauber: 4 });
    expect(r.abschluss.abweichungen).toEqual([{ forge: 'o/r', nr: 4, titel: 'Logbuch-Idee', zustand: 'offen, needs-triage', grund: 'in der Triage ohne offene Frage an den Menschen' }]);
    expect(r.zustand).toBe('unvollstaendig');
  });

  it('reports a note without an allowed end state as an error: ready without mission, child of a new mission without ready, closed without reason', async () => {
    // the mission's own release fails: its released children hang on a mission without Warp frei
    const f = welt();
    const { r } = await lauf(f, PLAN, ANTWORTEN, { scheitert: (a) => a[1] === 'edit' && a[2] === '100' && a.includes('--add-label') });
    expect(nr(r)).toEqual([1, 2, 4]);
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
