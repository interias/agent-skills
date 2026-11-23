// flotte chat (#84): the Bereitschaftsraum of the bridge as a service on the machine. A stand-in
// bridge (local HTTP), the stand-in for claude and a stand-in for gh show what goes where; the
// shared contract is flottenbruecke/beispiel/chat.json.

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Aufrufer } from '../src/aufruf.ts';
import { chat, ChatDienst, CHAT_MODELL, type ChatNachricht, chatErgebnisAus, nachrichtenAusJson } from '../src/befehle/chat.ts';
import { auftrag } from '../src/befehle/auftrag.ts';
import { Bruecke } from '../src/treiber/bruecke.ts';
import { schreibe as schreibeVerbrauch } from '../src/werkzeuge/verbrauch.ts';
import { drehbuch, mitAttrappe } from './attrappe.ts';
import { ENTWURF_EINZELN } from './auftrag-faelle.ts';

const T = 30_000;
const tmp = () => mkdtempSync(join(tmpdir(), 'flotte-chat-t-'));
const STUNDE = 3_600_000;
const beispiel = JSON.parse(readFileSync(fileURLToPath(new URL('../../flottenbruecke/beispiel/chat.json', import.meta.url)), 'utf8'));

interface Post {
  pfad: string;
  body: any;
  token: string | undefined;
}

/** A stand-in bridge: offers its messages until they have an answer, takes acknowledgements and answers. */
async function brueckenAttrappe(nachrichten: ChatNachricht[], o: { fremd?: number[] } = {}) {
  const posts: Post[] = [];
  const gets: string[] = [];
  const beantwortet = new Set<number>();
  const server: Server = createServer((req, res) => {
    let roh = '';
    req.on('data', (x) => (roh += x));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const senden = (status: number, daten: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(daten));
      };
      if (req.headers['x-bruecke-token'] !== 'geheim') return senden(401, { detail: 'token' });
      if (req.method === 'GET' && url.pathname === '/api/chat/nachrichten') {
        gets.push(url.search);
        return senden(200, nachrichten.filter((n) => !beantwortet.has(n.id)));
      }
      const m = /^\/api\/chat\/nachrichten\/(\d+)\/(quittung|antwort)$/.exec(url.pathname);
      if (req.method === 'POST' && m) {
        const id = Number(m[1]);
        posts.push({ pfad: url.pathname, body: roh ? JSON.parse(roh) : null, token: req.headers['x-bruecke-token'] as string | undefined });
        if (m[2] === 'quittung' && o.fremd?.includes(id)) return senden(409, { detail: 'anderer Rechner' });
        if (m[2] === 'antwort') beantwortet.add(id);
        return senden(200, { ok: true });
      }
      senden(404, { detail: 'unbekannt' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  offen.push(server);
  return { url, posts, gets, bruecke: new Bruecke(url, 'geheim') };
}

const offen: Server[] = [];
afterEach(() => {
  for (const s of offen.splice(0)) s.close();
});

/** an account folder with a fresh green usage value */
function konto(anteil = 0.1): string {
  const k = tmp();
  const jetzt = Date.now();
  schreibeVerbrauch(k, { zeit: jetzt, fuenf: { anteil, reset: jetzt + 3 * STUNDE }, sieben: { anteil: 0.1, reset: jetzt + 96 * STUNDE } });
  return k;
}

/** A stand-in for gh: creates issues 57, 58, ... in interias/demo; every call is kept. */
function ghAttrappe() {
  const aufrufe: { args: string[]; eingabe?: string }[] = [];
  let nr = 57;
  const aufrufer: Aufrufer = (programm, args, o) => {
    aufrufe.push({ args: [programm, ...args], eingabe: o?.eingabe });
    if (args[0] === 'issue' && args[1] === 'create') return { code: 0, stdout: `https://github.com/interias/demo/issues/${nr++}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { aufrufer, aufrufe };
}

function welt(url: Bruecke, tafel: Record<string, string>, datei: string, aufrufer?: Aufrufer) {
  const repos = tmp();
  mkdirSync(join(repos, 'demo', '.claude'), { recursive: true });
  writeFileSync(join(repos, 'demo', '.claude', 'epic.md'), '---\napi: https://api.github.com/repos/interias/demo\n---\n');
  return { repos, dienst: new ChatDienst({ bruecke: url, repos, ordner: tmp(), rechner: 'rechner-a', tafel, programm: mitAttrappe(datei), aufrufer }) };
}

const nachricht = (o: Partial<ChatNachricht> = {}): ChatNachricht => ({ id: 7, chat: 3, forge: 'interias/demo', art: 'text', konto: '2', modell: null, text: 'Was macht der Treiber?', entwurf: null, starten: false, sitzung: null, zeit: '2026-11-23T10:00:00Z', ...o });

/** the result line of a turn with --json-schema */
const strukturiert = (o: unknown, result = '') => ({ zeile: { type: 'result', subtype: 'success', is_error: false, result, structured_output: o } });

const posts = (b: { posts: Post[] }, art: string) => b.posts.filter((p) => p.pfad.endsWith(`/${art}`));
const schluessel = (o: object) => Object.keys(o).sort();

describe('flotte chat', () => {
  it(
    'message → claude on the chat account with --resume in the repository → structured answer back to the bridge',
    async () => {
      const k2 = konto();
      const b = await brueckenAttrappe([nachricht({ sitzung: 'sitzung-alt', modell: 'claude-fable-5' })]);
      const karten = [{ frage: 'Q1 — Umfang (Einzelwahl)', optionen: ['A — zehn', 'B — alle'] }];
      const d = drehbuch([{ schritte: [strukturiert({ text: 'Der Treiber fährt Außeneinsätze.', karten, entwurf: '# Missionsziel: X\n' })] }]);
      const { repos, dienst } = welt(b.bruecke, { '1': tmp(), '2': k2, '3': join(tmp(), 'fehlt') }, d.datei);
      await dienst.takt();
      await dienst.fertig();
      const [g] = d.gesehen();
      expect(g.konto).toBe(k2);
      expect(g.eingabe).toBe('Was macht der Treiber?');
      expect(g.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json']));
      expect(g.args[g.args.indexOf('--resume') + 1]).toBe('sitzung-alt');
      expect(g.args[g.args.indexOf('--model') + 1]).toBe('claude-fable-5');
      expect(realpathSync(g.cwd).toLowerCase()).toBe(realpathSync(join(repos, 'demo')).toLowerCase());
      // the machine names itself and its accounts by short name, only those it has (review finding 1, decision 4)
      expect(b.gets[0]).toBe('?rechner=rechner-a&konten=1,2');
      expect(posts(b, 'quittung').map((p) => [p.pfad, p.body])).toEqual([['/api/chat/nachrichten/7/quittung', { rechner: 'rechner-a' }]]);
      const [a] = posts(b, 'antwort');
      expect([a.pfad, a.body]).toEqual(['/api/chat/nachrichten/7/antwort', { text: 'Der Treiber fährt Außeneinsätze.', sitzung: 'sitzung-alt', fehler: null, karten, entwurf: '# Missionsziel: X\n' }]);
      // the shape of beispiel/chat.json
      expect(schluessel(a.body)).toEqual(schluessel(beispiel.antworten[0]));
      expect(schluessel(a.body.karten[0])).toEqual(schluessel(beispiel.antworten[0].karten[0]));
      // nothing of the machine goes to the bridge: no path, no account folder
      for (const p of b.posts) expect(JSON.stringify(p.body)).not.toContain(tmpdir().replace(/\\/g, '\\\\'));
    },
    T,
  );

  it(
    'a new chat starts without --resume on Opus 5.5 and returns its new session; the next message resumes it',
    async () => {
      const b = await brueckenAttrappe([nachricht({ id: 1 }), nachricht({ id: 2, text: 'Und weiter?' })]);
      const d = drehbuch([
        { sitzung: 'neu-1', schritte: [strukturiert({ text: 'Erste Antwort', karten: [], entwurf: null })] },
        { schritte: [strukturiert({ text: 'Zweite Antwort', karten: [], entwurf: null })] },
      ]);
      const { dienst } = welt(b.bruecke, { '2': konto() }, d.datei);
      await dienst.takt();
      await dienst.fertig();
      // one turn per chat at a time: the second message waits for the first answer
      expect(d.gesehen()).toHaveLength(1);
      await dienst.takt();
      await dienst.fertig();
      const [g1, g2] = d.gesehen();
      expect(g1.args).not.toContain('--resume');
      expect(g1.args[g1.args.indexOf('--model') + 1]).toBe(CHAT_MODELL);
      expect(g2.args[g2.args.indexOf('--resume') + 1]).toBe('neu-1');
      expect(posts(b, 'antwort').map((p) => p.body)).toEqual([
        { text: 'Erste Antwort', sitzung: 'neu-1', fehler: null, karten: [], entwurf: null },
        { text: 'Zweite Antwort', sitzung: 'neu-1', fehler: null, karten: [], entwurf: null },
      ]);
    },
    T,
  );

  it(
    'writing tools are locked: read tools only, reading only in the repository, no Bash; a turn with more tools ends',
    async () => {
      const b = await brueckenAttrappe([nachricht()]);
      const d = drehbuch([{ werkzeuge: ['Read', 'Grep', 'Glob', 'StructuredOutput', 'Edit'], schritte: [{ warte: 2000 }, { text: 'zu spät' }] }]);
      const { dienst } = welt(b.bruecke, { '2': konto() }, d.datei);
      await dienst.takt();
      await dienst.fertig();
      const [g] = d.gesehen();
      const nach = (f: string) => g.args[g.args.indexOf(f) + 1];
      expect(g.args.filter((a: string) => a === '--permission-mode')).toHaveLength(1);
      expect(nach('--permission-mode')).toBe('dontAsk');
      expect(nach('--tools').split(',').sort()).toEqual(['Glob', 'Grep', 'Read']);
      // only a path rule on the working directory: a bare Read, Grep or Glob would allow every path
      expect(nach('--allowedTools').split(',')).toEqual(['Read(./**)']);
      expect(g.args.filter((a: string) => a === '--allowedTools')).toHaveLength(1);
      for (const w of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Task', 'WebFetch', 'Skill']) {
        expect(nach('--tools').split(',')).not.toContain(w);
        expect(nach('--allowedTools')).not.toContain(w);
      }
      expect(g.args).toContain('--strict-mcp-config');
      expect(JSON.parse(nach('--json-schema')).required).toEqual(['text', 'karten', 'entwurf']);
      // the skill goes along as text: no read rule outside the repository, no path of the machine
      const rahmen = nach('--append-system-prompt');
      expect(rahmen).toContain('# Bereitschaftsraum');
      expect(rahmen).toContain('Anlegen tust du nicht');
      expect(rahmen).not.toMatch(/bereitschaftsraum[\\/]SKILL\.md/i);
      // the stand-in claims Edit: the turn is killed, the person gets a message instead of its text
      expect(posts(b, 'antwort')[0].body).toEqual({ text: null, sitzung: 'sitzung-0', fehler: 'Der Aufruf scheiterte (werkzeuge).', karten: [], entwurf: null });
    },
    T,
  );

  it(
    'an answer that does not fit the schema goes back as text with a message, never lost',
    async () => {
      const b = await brueckenAttrappe([nachricht({ id: 1, chat: 1 }), nachricht({ id: 2, chat: 2 })]);
      const d = drehbuch([
        { schritte: [strukturiert({ text: 1, karten: 'keine' }, 'Roher Text der Antwort')] },
        { schritte: [strukturiert({ text: 'x', karten: [{ frage: 'F', optionen: [1] }], entwurf: null })] },
      ]);
      const { dienst } = welt(b.bruecke, { '2': konto() }, d.datei);
      await dienst.takt();
      await dienst.fertig();
      const bodies = posts(b, 'antwort').map((p) => p.body);
      expect(bodies).toHaveLength(2);
      for (const a of bodies) {
        expect(a.fehler).toBe('Die Antwort hatte nicht die verlangte Form (text, karten, entwurf); ihr Text steht hier unverändert.');
        expect(a.karten).toEqual([]);
        expect(a.entwurf).toBeNull();
      }
      expect(bodies.map((a) => a.text).sort()).toEqual(['Roher Text der Antwort', JSON.stringify({ text: 'x', karten: [{ frage: 'F', optionen: [1] }], entwurf: null })].sort());
    },
    T,
  );

  it(
    'anlegen: the service runs flotte auftrag with the draft on stdin (--starten when asked), no claude, no brake, and reports the created issues',
    async () => {
      const b = await brueckenAttrappe([nachricht({ art: 'anlegen', text: null, entwurf: ENTWURF_EINZELN, starten: true, sitzung: 's5', konto: '2' })]);
      const d = drehbuch([{ schritte: [{ text: 'darf nicht laufen' }] }]);
      const gh = ghAttrappe();
      // a red account: anlegen calls no model, so the brake does not apply
      const { dienst } = welt(b.bruecke, { '2': konto(0.95) }, d.datei, gh.aufrufer);
      await dienst.takt();
      await dienst.fertig();
      expect(d.gesehen()).toHaveLength(0);
      const erstellt = gh.aufrufe.filter((x) => x.args[1] === 'issue' && x.args[2] === 'create');
      expect(erstellt).toHaveLength(1);
      expect(erstellt[0].args).toEqual(expect.arrayContaining(['--repo', 'interias/demo', '--title', 'Einzelnes Ziel', '--label', 'ready-for-agent']));
      expect(erstellt[0].eingabe).toContain('## Abnahmekriterien\n- geht');
      const [a] = posts(b, 'antwort');
      expect(a.body).toEqual({
        text: expect.stringMatching(/^Angelegt mit Warp frei: Missionsziel #57 „Einzelnes Ziel“\.\n\nHinweise:\n- Missionsziel „Einzelnes Ziel“ ohne `## Betroffene Module`/),
        sitzung: 's5',
        fehler: null,
        karten: [],
        entwurf: null,
        missionen: [{ nummer: 57, url: 'https://github.com/interias/demo/issues/57', titel: 'Einzelnes Ziel' }],
      });
      expect(schluessel(a.body)).toEqual(schluessel(beispiel.antworten[1]));
      expect(schluessel(a.body.missionen[0])).toEqual(schluessel(beispiel.antworten[1].missionen[0]));
    },
    T,
  );

  it(
    'anlegen without --starten takes needs-triage; a draft the writer refuses comes back as fehler with no missions and no path',
    async () => {
      const luecke = ENTWURF_EINZELN.replace(/## Verifikationsweg\nTest\.\n/, '');
      const b = await brueckenAttrappe([nachricht({ id: 1, chat: 1, art: 'anlegen', text: null, entwurf: ENTWURF_EINZELN, starten: false }), nachricht({ id: 2, chat: 2, art: 'anlegen', text: null, entwurf: luecke, starten: true })]);
      const gh = ghAttrappe();
      const { repos, dienst } = welt(b.bruecke, { '2': konto() }, drehbuch([]).datei, gh.aufrufer);
      await dienst.takt();
      await dienst.fertig();
      const erstellt = gh.aufrufe.filter((x) => x.args[1] === 'issue' && x.args[2] === 'create');
      expect(erstellt).toHaveLength(1);
      expect(erstellt[0].args).toEqual(expect.arrayContaining(['--label', 'needs-triage']));
      const nach = Object.fromEntries(posts(b, 'antwort').map((p) => [p.pfad, p.body]));
      expect(nach['/api/chat/nachrichten/1/antwort']).toMatchObject({ text: expect.stringMatching(/^Angelegt als Sternzeit-Notiz: Missionsziel #57 „Einzelnes Ziel“\./), fehler: null });
      expect(nach['/api/chat/nachrichten/2/antwort']).toMatchObject({ text: null, missionen: [], karten: [], entwurf: null });
      expect(nach['/api/chat/nachrichten/2/antwort'].fehler).toMatch(/^Anlegen gescheitert: Nichts angelegt, Pflichtabschnitte fehlen:/);
      expect(JSON.stringify(nach)).not.toContain(repos.replace(/\\/g, '\\\\'));
    },
    T,
  );

  it(
    'obeys the usage brake: on red a message to the bridge and no call',
    async () => {
      const b = await brueckenAttrappe([nachricht({ sitzung: 's9' })]);
      const d = drehbuch([{ schritte: [{ text: 'darf nicht laufen' }] }]);
      const { dienst } = welt(b.bruecke, { '2': konto(0.95) }, d.datei);
      await dienst.takt();
      await dienst.fertig();
      expect(d.gesehen()).toHaveLength(0);
      const [a] = posts(b, 'antwort');
      expect(a.body).toMatchObject({ text: null, sitzung: 's9', karten: [], entwurf: null });
      expect(a.body).not.toHaveProperty('missionen');
      expect(a.body.fehler).toMatch(/^Verbrauchsbremse rot auf Konto 2 \(verbraucht 95 %.*kein Aufruf/);
    },
    T,
  );

  it(
    'a missing usage value is fetched by a small haiku run first, then the turn runs',
    async () => {
      const b = await brueckenAttrappe([nachricht()]);
      const d = drehbuch([{ wenn: 'FLOTTE-PING', schritte: [{ verbrauch: [0.2, 0.1] }, { text: 'OK' }] }, { wenn: 'Treiber', schritte: [strukturiert({ text: 'Antwort', karten: [], entwurf: null })] }]);
      const { dienst } = welt(b.bruecke, { '2': tmp() }, d.datei);
      await dienst.takt();
      await dienst.fertig();
      const [ping, turn] = d.gesehen();
      expect(ping.args[ping.args.indexOf('--model') + 1]).toBe('haiku');
      expect(ping.args[ping.args.indexOf('--tools') + 1]).toBe('');
      expect(turn.eingabe).toBe('Was macht der Treiber?');
      expect(posts(b, 'antwort')[0].body).toMatchObject({ text: 'Antwort', fehler: null });
    },
    T,
  );

  it(
    'two chats of one account with a stale value in the same turn share one ping (review finding 5)',
    async () => {
      const b = await brueckenAttrappe([nachricht({ id: 1, chat: 1 }), nachricht({ id: 2, chat: 2 })]);
      const d = drehbuch([{ wenn: 'FLOTTE-PING', schritte: [{ warte: 500 }, { verbrauch: [0.2, 0.1] }, { text: 'OK' }] }, { wenn: 'Treiber', schritte: [strukturiert({ text: 'Antwort', karten: [], entwurf: null })] }]);
      const { dienst } = welt(b.bruecke, { '2': tmp() }, d.datei);
      await dienst.takt();
      await dienst.fertig();
      const gesehen = d.gesehen();
      expect(gesehen.filter((g) => g.eingabe.includes('FLOTTE-PING'))).toHaveLength(1);
      expect(gesehen.filter((g) => g.eingabe === 'Was macht der Treiber?')).toHaveLength(2);
      expect(posts(b, 'antwort').map((p) => p.body.fehler)).toEqual([null, null]);
    },
    T,
  );

  it(
    'a message another machine took (409) is left alone; an unknown repository or account gets a message without a path',
    async () => {
      const b = await brueckenAttrappe([nachricht({ id: 1, chat: 1 }), nachricht({ id: 2, chat: 2, forge: 'interias/fehlt' }), nachricht({ id: 3, chat: 3, konto: '9' })], { fremd: [1] });
      const d = drehbuch([{ schritte: [{ text: 'nie' }] }]);
      const { dienst } = welt(b.bruecke, { '2': konto() }, d.datei);
      await dienst.takt();
      await dienst.fertig();
      expect(d.gesehen()).toHaveLength(0);
      // chats 2 and 3 run side by side: their answers come in either order
      expect(posts(b, 'antwort').map((p) => [p.pfad, p.body.fehler]).sort()).toEqual([
        ['/api/chat/nachrichten/2/antwort', 'Das Repository fehlt liegt auf dem Rechner rechner-a nicht im Ordner des Bereitschaftsraums.'],
        ['/api/chat/nachrichten/3/antwort', 'Konto 9 ist auf dem Rechner rechner-a nicht bekannt.'],
      ]);
    },
    T,
  );

  it('drops messages that do not fit the contract (a path as account, a model or session that could be a flag, a path in forge, a missing art or draft)', () => {
    const gut = nachricht();
    const anlegen = nachricht({ id: 8, art: 'anlegen', text: null, entwurf: ENTWURF_EINZELN, starten: true });
    const schlecht = [
      { ...gut, konto: 'C:/konto' },
      { ...gut, modell: '--dangerously-skip-permissions' },
      { ...gut, sitzung: '-x' },
      { ...gut, forge: '../x' },
      { ...gut, text: ' ' },
      { ...gut, art: undefined },
      { ...gut, art: 'bash' },
      { ...anlegen, entwurf: ' ' },
      { ...anlegen, starten: 'ja' },
      null,
    ];
    expect(nachrichtenAusJson([gut, ...schlecht, anlegen])).toEqual([gut, anlegen]);
    expect(nachrichtenAusJson({ nicht: 'liste' })).toEqual([]);
    // a text message never carries a draft to the writer
    expect(nachrichtenAusJson([{ ...gut, entwurf: 'x', starten: true }])).toEqual([gut]);
  });

  it('beispiel/chat.json fits the service: both messages are taken, both answers are read back', () => {
    expect(nachrichtenAusJson(beispiel.nachrichten)).toHaveLength(2);
    expect(nachrichtenAusJson(beispiel.nachrichten).map((n) => n.art)).toEqual(['text', 'anlegen']);
    expect(chatErgebnisAus(beispiel.antworten[0])).toEqual({ text: beispiel.antworten[0].text, karten: beispiel.antworten[0].karten, entwurf: null });
    expect(Object.keys(beispiel.quittung)).toEqual(['rechner']);
  });

  it('an empty text does not fit the schema: the bridge needs text or fehler', () => {
    expect(chatErgebnisAus({ text: '', karten: [], entwurf: null })).toBeNull();
    expect(chatErgebnisAus({ text: '  ', karten: [{ frage: 'Q1', optionen: ['A'] }], entwurf: null })).toBeNull();
  });

  it(
    'one service per machine: a second start is refused',
    async () => {
      const ordner = tmp();
      const kind = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore', windowsHide: true });
      try {
        writeFileSync(join(ordner, 'treiber.lock'), JSON.stringify({ pid: kind.pid, seit: '2026-11-23T10:00:00Z' }));
        await expect(chat(['--repos', tmp(), '--bruecke', 'http://127.0.0.1:9'], ordner)).rejects.toThrow(/läuft schon ein flotte chat \(PID \d+/);
        await expect(chat(['--bruecke', 'http://127.0.0.1:9'], ordner)).rejects.toThrow(/Aufruf: flotte chat --repos/);
      } finally {
        kind.kill();
      }
    },
    T,
  );

  it('flotte auftrag takes the draft from stdin with `-`', async () => {
    const dir = tmp();
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'epic.md'), '---\nforge: gitea\napi: https://gitea.example/api/v1/repos/o/r\n---\n');
    const r = (await auftrag([dir, '-', '--trocken'], () => ({ code: 1, stdout: '', stderr: '' }), () => '# Missionsziel: Aus dem Chat\n\n## Abnahmekriterien\n- x\n\n## Verifikationsweg\nbun test\n')) as any;
    expect(r.forge).toBe('o/r');
    expect(r.trocken).toBe(true);
    expect(JSON.stringify(r)).toContain('Aus dem Chat');
  });
});
