// flotte chat --repos <ordner> [--bruecke <url>] [--takt-s 10]: the Bereitschaftsraum of the
// Flottenbrücke (#84, agent-skills/ADR-0004). One service per machine fetches the chat messages from
// the bridge, runs one `claude -p` turn per message in the chat's session (--resume) on the chat's
// account and model, and delivers the structured answer (text, question cards, draft). It obeys the
// usage brake: on red it answers with a message and starts nothing. The model only reads the
// repository; the order writer (`flotte auftrag`, ADR-0002) runs when the person presses "anlegen"
// in the bridge, called by this service, not by the model. The contract is
// flottenbruecke/SCHNITTSTELLE.md, "Bereitschaftsraum (Chat)". The bridge gets short names and
// texts, never a path or a credential.

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aufrufen, type Aufrufer } from '../aufruf.ts';
import { Bruecke, rechnerName } from '../treiber/bruecke.ts';
import { kontenTafel, kontoAus } from '../werkzeuge/konten.ts';
import { starte, type LaufErgebnis, type Start } from '../werkzeuge/lauf.ts';
import { bewerte, lies as liesVerbrauch, type Bewertung } from '../werkzeuge/verbrauch.ts';
import { entsperren, sperren } from '../werkzeuge/zustand.ts';
import { auftrag } from './auftrag.ts';
import { LESESPERRE } from './chat-lesesperre.ts';

const AUFRUF = 'Aufruf: flotte chat --repos <ordner> [--bruecke <url>] [--takt-s 10]. Der Ordner enthält je Repository einen Checkout mit dem Namen des Repositorys (owner/name → <ordner>/name). Basis-URL auch aus FLOTTE_BRUECKE, Token aus FLOTTE_BRUECKE_TOKEN.';

/** the model of a chat that names none */
export const CHAT_MODELL = 'claude-opus-5-5';
/** a stale or missing usage value is red; a small run fetches a fresh one, as the driver's ping does */
const PING_MODELL = 'haiku';
const MAX_ALTER_MIN = 30;

const BEREITSCHAFTSRAUM = fileURLToPath(new URL('../../../bereitschaftsraum/SKILL.md', import.meta.url));

/** The tools the init event of a chat turn may list: reading, and the structured answer of --json-schema. */
export const CHAT_WERKZEUGE = ['Read', 'Grep', 'Glob', 'StructuredOutput'];

/**
 * --tools leaves only the read tools (no Bash, Edit, Write, NotebookEdit, Task, WebFetch, ...), and
 * dontAsk refuses every tool that would ask, so nothing writes. Reading is not locked by that: read
 * tools need no approval in Claude Code, so a permission rule does not narrow them; the real probe of
 * 23.11.2026 read a file outside the repository under `--allowedTools Read(./**)` with
 * permission_denials []. The lock is the PreToolUse hook of lesesperreArgs. `Read(./**)` stays only so
 * that reads in the repository keep running should Claude Code ever ask for them under dontAsk; it
 * opens nothing a bare `Read` would (that would allow every path, should reads ever be asked for).
 * --strict-mcp-config comes with every run (claudeArgs). The skill text goes into the system
 * prompt, so the model needs nothing outside the repository.
 */
export function chatArgs(): string[] {
  return ['--tools', 'Read,Grep,Glob', '--allowedTools', 'Read(./**)', ...lesesperreArgs(), '--json-schema', JSON.stringify(chatSchema()), '--append-system-prompt', chatRahmen()];
}

/**
 * The read lock as a hook of the session, as guardArgs in the driver: chat-lesesperre.ts refuses Read,
 * Grep and Glob outside the working directory with exit 2. It runs with the bun of this service
 * (process.execPath), not one from the PATH; onFailure block: a hook that fails refuses the read.
 */
export function lesesperreArgs(): string[] {
  const befehl = `"${process.execPath}" "${LESESPERRE}"`;
  return ['--settings', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Read|Grep|Glob', hooks: [{ type: 'command', command: befehl, timeout: 30, onFailure: 'block' }] }] } })];
}

export function chatRahmen(): string {
  return [
    'Du bist der Bereitschaftsraum auf der Flottenbrücke: ein Chat mit dem Menschen, aus dem eine Mission, ein Missionsziel oder nichts entsteht. Arbeite nach dem Skill unten, im Fall „Darfst du nicht schreiben“. Für diesen Chat gilt dazu:',
    '- Du hast nur Read, Grep und Glob, und nur im Repository (dem Arbeitsverzeichnis). Du führst keinen Befehl aus und schreibst nichts; Dateien außerhalb des Repositorys sind gesperrt.',
    '- Deine Antwort ist das strukturierte Ergebnis: `text` ist deine Nachricht an den Menschen (Markdown). `karten` sind die Fragen der Runde, je Frage `frage` (Titel, Sachverhalt, Einzel- oder Mehrfachwahl, Empfehlung mit Grund) und `optionen` (kurze Wahlen wie „A — …“; der Mensch darf immer frei antworten). `entwurf` ist der vollständige Entwurf im Format des Auftragsschreibers, sobald er steht, sonst null.',
    '- Anlegen tust du nicht. Der Mensch wählt in der Brücke „anlegen“ oder „anlegen und starten“; dann legt der Dienst deinen letzten Entwurf mit dem Auftragsschreiber an. Einen Trockenlauf gibt es hier nicht: prüfe selbst, dass jedes Missionsziel die Pflichtabschnitte des Adapters hat.',
    '- In deine Antwort kommen keine lokalen Pfade, keine Zugangsdaten und nichts von außerhalb des Repositorys.',
    '',
    '--- Skill Bereitschaftsraum ---',
    readFileSync(BEREITSCHAFTSRAUM, 'utf8'),
  ].join('\n');
}

/** The structured answer of a chat turn (--json-schema), as triage.ts does it with triageSchema(). */
export function chatSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'karten', 'entwurf'],
    properties: {
      text: { type: 'string' },
      karten: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['frage', 'optionen'], properties: { frage: { type: 'string' }, optionen: { type: 'array', items: { type: 'string' } } } },
      },
      entwurf: { type: ['string', 'null'] },
    },
  };
}

export interface Karte {
  frage: string;
  optionen: string[];
}

/** The structured answer when it fits the schema, else null. */
export function chatErgebnisAus(roh: unknown): { text: string; karten: Karte[]; entwurf: string | null } | null {
  const o = roh as any;
  if (!o || typeof o !== 'object' || typeof o.text !== 'string' || !o.text.trim() || !Array.isArray(o.karten)) return null;
  if (!(o.entwurf === null || typeof o.entwurf === 'string')) return null;
  if (!o.karten.every((k: any) => k && typeof k.frage === 'string' && Array.isArray(k.optionen) && k.optionen.every((x: unknown) => typeof x === 'string'))) return null;
  return { text: o.text, karten: o.karten.map((k: Karte) => ({ frage: k.frage, optionen: k.optionen })), entwurf: o.entwurf?.trim() ? o.entwurf : null };
}

/**
 * A chat message as GET /api/chat/nachrichten delivers it. art `text`: a turn of the model in the
 * chat's session. art `anlegen`: the person pressed "anlegen" (starten false) or "anlegen und
 * starten" (starten true) on the draft; the service runs the order writer, no model.
 */
export interface ChatNachricht {
  id: number;
  chat: number;
  forge: string;
  art: 'text' | 'anlegen';
  /** short name of the account (`1`, `2`, `3`), never a path */
  konto: string;
  modell: string | null;
  /** the person's text; may be null with art anlegen */
  text: string | null;
  /** the draft to create, only with art anlegen */
  entwurf: string | null;
  starten: boolean;
  /** the claude session of the chat, null before its first answer */
  sitzung: string | null;
  zeit: string;
}

/** An issue created for an anlegen message, from the order writer's result. */
export interface ChatMission {
  nummer: number;
  url: string;
  titel: string;
}

export interface ChatAntwort {
  text: string | null;
  sitzung: string | null;
  fehler: string | null;
  karten: Karte[];
  entwurf: string | null;
  /** only on an answer to art anlegen: what the order writer created, empty when it failed */
  missionen?: ChatMission[];
}

const FORGE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MODELL = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,80}$/;
const SITZUNG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/;
const voll = (x: unknown) => typeof x === 'string' && Boolean(x.trim());

/** The messages of GET /api/chat/nachrichten; entries that do not fit the contract are dropped. */
export function nachrichtenAusJson(roh: unknown): ChatNachricht[] {
  if (!Array.isArray(roh)) return [];
  return roh
    .filter(
      (n) =>
        Boolean(n) &&
        Number.isInteger(n.id) &&
        Number.isInteger(n.chat) &&
        typeof n.forge === 'string' &&
        FORGE.test(n.forge) &&
        typeof n.konto === 'string' &&
        /^\d+$/.test(n.konto) &&
        (n.modell === null || n.modell === undefined || (typeof n.modell === 'string' && MODELL.test(n.modell))) &&
        (n.sitzung === null || n.sitzung === undefined || (typeof n.sitzung === 'string' && SITZUNG.test(n.sitzung))) &&
        ((n.art === 'text' && voll(n.text)) || (n.art === 'anlegen' && voll(n.entwurf) && typeof n.starten === 'boolean')),
    )
    .map((n) => ({ ...n, modell: n.modell ?? null, sitzung: n.sitzung ?? null, text: n.text ?? null, entwurf: n.art === 'anlegen' ? n.entwurf : null, starten: n.art === 'anlegen' && n.starten }));
}

export interface ChatWelt {
  bruecke: Bruecke;
  /** the folder with one checkout per repository name */
  repos: string;
  /** where the logs of the chat turns go, outside every repository */
  ordner: string;
  rechner?: string;
  tafel?: Record<string, string>;
  starte?: (s: Start) => Promise<LaufErgebnis>;
  /** runs gh and git for the order writer: the stand-in in tests */
  aufrufer?: Aufrufer;
  jetzt?: () => number;
  /** the program instead of claude: the stand-in in tests */
  programm?: Pick<Start, 'programm' | 'programmArgs'>;
  abbruch?: AbortSignal;
}

export class ChatDienst {
  /** chats with a turn running: one turn per chat at a time, so --resume continues the last one */
  readonly laufend = new Set<number>();
  /** answers the bridge has not taken yet, by message id; delivered again each turn, never run again */
  readonly offen = new Map<number, ChatAntwort>();
  /** the newest session per chat; newer than what the bridge delivers while an answer is on its way */
  readonly sitzungen = new Map<number, string>();
  /** the last ping per account, as letzterPing in the driver: chats of one account share it (review finding 5) */
  readonly letzterPing = new Map<string, { zeit: number; lauf: Promise<unknown> }>();
  private readonly arbeit = new Set<Promise<void>>();

  constructor(readonly w: ChatWelt) {}

  get rechner(): string {
    return this.w.rechner ?? rechnerName();
  }

  get tafel(): Record<string, string> {
    return this.w.tafel ?? kontenTafel();
  }

  /** the short names of the accounts this machine has, for the person's choice in the bridge; never a path */
  konten(): string[] {
    return Object.keys(this.tafel).filter((k) => /^\d+$/.test(k) && existsSync(kontoAus(k, this.tafel)));
  }

  /** One turn: deliver what is still open, fetch the messages, start a turn for each chat that is free. */
  async takt(): Promise<void> {
    for (const [id, a] of this.offen) if (await this.liefere(id, a)) this.offen.delete(id);
    const roh = await this.w.bruecke.rufe(`api/chat/nachrichten?rechner=${encodeURIComponent(this.rechner)}&konten=${this.konten().join(',')}`);
    if (roh === undefined) return;
    for (const n of nachrichtenAusJson(roh).sort((a, b) => a.id - b.id)) {
      if (this.offen.has(n.id) || this.laufend.has(n.chat)) continue;
      // taken by this machine; 409 (the chat belongs to another machine or has a message running) or a bridge that is off: not now
      if ((await this.w.bruecke.rufe(`api/chat/nachrichten/${n.id}/quittung`, { method: 'POST', body: JSON.stringify({ rechner: this.rechner }) })) === undefined) continue;
      this.laufend.add(n.chat);
      const p = this.bearbeite(n)
        .catch((): ChatAntwort => ({ text: null, sitzung: this.sitzungen.get(n.chat) ?? n.sitzung, fehler: 'Der Aufruf scheiterte auf dem Rechner.', karten: [], entwurf: null, ...(n.art === 'anlegen' ? { missionen: [] } : {}) }))
        .then(async (a) => {
          if (a.sitzung) this.sitzungen.set(n.chat, a.sitzung);
          if (!(await this.liefere(n.id, a))) this.offen.set(n.id, a);
        })
        .finally(() => {
          this.laufend.delete(n.chat);
          this.arbeit.delete(p);
        });
      this.arbeit.add(p);
    }
  }

  /** resolves when every running turn has delivered or parked its answer */
  async fertig(): Promise<void> {
    while (this.arbeit.size) await Promise.all([...this.arbeit]);
  }

  async liefere(id: number, a: ChatAntwort): Promise<boolean> {
    return (await this.w.bruecke.rufe(`api/chat/nachrichten/${id}/antwort`, { method: 'POST', body: JSON.stringify(a) })) !== undefined;
  }

  async bearbeite(n: ChatNachricht): Promise<ChatAntwort> {
    const sitzung = this.sitzungen.get(n.chat) ?? n.sitzung;
    const fehler = (text: string): ChatAntwort => ({ text: null, sitzung, fehler: text, karten: [], entwurf: null, ...(n.art === 'anlegen' ? { missionen: [] } : {}) });
    const name = n.forge.split('/')[1];
    const repo = join(this.w.repos, name);
    if (!existsSync(repo) || !statSync(repo).isDirectory()) return fehler(`Das Repository ${name} liegt auf dem Rechner ${this.rechner} nicht im Ordner des Bereitschaftsraums.`);
    if (n.art === 'anlegen') return this.lege(n, repo, name, sitzung);
    let konto: string;
    try {
      konto = kontoAus(n.konto, this.tafel);
    } catch {
      return fehler(`Konto ${n.konto} ist auf dem Rechner ${this.rechner} nicht bekannt.`);
    }
    const b = await this.bremse(konto, repo);
    if (b.stufe === 'rot') return fehler(`Verbrauchsbremse rot auf Konto ${n.konto} (${b.grund}): kein Aufruf. Später noch einmal senden.`);
    const r = await (this.w.starte ?? starte)({
      ...(this.w.programm ?? {}),
      repo,
      konto,
      auftrag: n.text ?? '',
      resume: sitzung,
      modell: n.modell ?? CHAT_MODELL,
      modus: 'dontAsk',
      extraArgs: chatArgs(),
      werkzeuge: chatWerkzeuge,
      leerlaufMs: 10 * 60_000,
      log: join(this.w.ordner, `chat-${n.chat}.jsonl`),
      abbruch: this.w.abbruch,
    });
    const neu = r.sitzung ?? sitzung;
    const s = chatErgebnisAus(r.strukturiert);
    // an answer that does not fit the schema goes back as text with a message, never lost
    const roh = r.text.trim() || (r.strukturiert != null ? JSON.stringify(r.strukturiert) : '');
    const basis: ChatAntwort = s ? { text: s.text, sitzung: neu, fehler: null, karten: s.karten, entwurf: s.entwurf } : { text: roh || null, sitzung: neu, fehler: null, karten: [], entwurf: null };
    if (r.fehler) return { ...basis, fehler: `Der Aufruf scheiterte (${r.fehler}).` };
    if (!s) return { ...basis, fehler: 'Die Antwort hatte nicht die verlangte Form (text, karten, entwurf); ihr Text steht hier unverändert.' };
    return basis;
  }

  /**
   * art anlegen: the person's choice in the bridge is the gate (ADR-0002, Bereitschaftsraum step 3);
   * the order writer runs here as `flotte auftrag <repo> - [--starten]` with the draft on stdin.
   * No claude call, so no usage brake.
   */
  async lege(n: ChatNachricht, repo: string, name: string, sitzung: string | null): Promise<ChatAntwort> {
    const basis = { sitzung, karten: [], entwurf: null };
    try {
      const r = (await auftrag([repo, '-', ...(n.starten ? ['--starten'] : [])], this.w.aufrufer ?? aufrufen, () => n.entwurf ?? '')) as { mission: ChatMission | null; ziele: ChatMission[]; hinweise: string[] };
      const missionen = [...(r.mission ? [r.mission] : []), ...r.ziele].map(({ nummer, url, titel }) => ({ nummer, url, titel }));
      const liste = missionen.map((m, i) => `${r.mission && i === 0 ? 'Mission' : 'Missionsziel'} #${m.nummer} „${m.titel}“`).join(', ');
      const hinweise = r.hinweise.length ? `\n\nHinweise:\n- ${r.hinweise.join('\n- ')}` : '';
      return { ...basis, text: `Angelegt ${n.starten ? 'mit Warp frei' : 'als Sternzeit-Notiz'}: ${liste}.${hinweise}`, fehler: null, missionen };
    } catch (err) {
      // the writer names a missing checkout or origin with its path: the bridge gets the repository name
      const text = [resolve(repo), repo].reduce((t, p) => t.split(p).join(name), (err as Error).message);
      return { ...basis, text: null, fehler: `Anlegen gescheitert: ${text}`, missionen: [] };
    }
  }

  /** The brake of the account; a stale or missing value first gets a fresh one from a small run, one per account at a time. */
  async bremse(konto: string, repo: string): Promise<Bewertung> {
    const jetzt = this.w.jetzt ?? Date.now;
    const v = liesVerbrauch(konto);
    const b = bewerte(v, jetzt(), MAX_ALTER_MIN);
    if (b.stufe !== 'rot' || (v && b.alterMin !== null && b.alterMin <= MAX_ALTER_MIN)) return b;
    const zuletzt = this.letzterPing.get(konto);
    if (zuletzt && jetzt() - zuletzt.zeit < (MAX_ALTER_MIN * 60_000) / 2) await zuletzt.lauf;
    else {
      const lauf = (this.w.starte ?? starte)({ ...(this.w.programm ?? {}), repo, konto, auftrag: 'FLOTTE-PING Antworte nur mit OK.', modell: PING_MODELL, leerlaufMs: 5 * 60_000, extraArgs: ['--tools', ''], abbruch: this.w.abbruch });
      this.letzterPing.set(konto, { zeit: jetzt(), lauf });
      await lauf;
    }
    return bewerte(liesVerbrauch(konto), jetzt(), MAX_ALTER_MIN);
  }
}

/** What the init event of a chat turn may list; anything else ends the turn (fehler 'werkzeuge'). */
export function chatWerkzeuge(tools: string[]): string | null {
  const fremd = tools.filter((t) => !CHAT_WERKZEUGE.includes(t));
  return fremd.length ? `Chat mit unerwarteten Werkzeugen: ${fremd.slice(0, 8).join(', ')}${fremd.length > 8 ? ` und ${fremd.length - 8} weitere` : ''}` : null;
}

function wert(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** flotte chat: runs until Ctrl+C; a second start on the same machine is refused. */
export async function chat(argv: string[], ordner = join(tmpdir(), 'flotte-chat')): Promise<unknown> {
  const repos = wert(argv, '--repos');
  if (!repos || !existsSync(repos)) throw new Error(AUFRUF);
  const url = wert(argv, '--bruecke') ?? process.env.FLOTTE_BRUECKE ?? null;
  if (!url || !/^https?:\/\//.test(url)) throw new Error(`--bruecke ${url ?? ''}: eine URL wie http://127.0.0.1:4747. ${AUFRUF}`);
  const taktMs = Number(wert(argv, '--takt-s') ?? 10) * 1000;
  if (!(taktMs > 0)) throw new Error(AUFRUF);
  mkdirSync(ordner, { recursive: true });
  const s = sperren(ordner);
  if (!s.ok) throw new Error(`Auf diesem Rechner läuft schon ein flotte chat (PID ${s.pid} seit ${s.seit}).`);
  const abbruch = new AbortController();
  process.once('SIGINT', () => {
    // running turns end with their process trees; their messages come again at the next start
    abbruch.abort('flotte chat mit Ctrl+C beendet');
    entsperren(ordner);
    process.stderr.write('Bereitschaftsraum beendet. Offene Nachrichten holt der nächste Start.\n');
    process.exit(130);
  });
  const d = new ChatDienst({ bruecke: new Bruecke(url, process.env.FLOTTE_BRUECKE_TOKEN || null), repos, ordner, abbruch: abbruch.signal });
  process.stderr.write(`Bereitschaftsraum auf ${d.rechner}: Brücke ${url}, Takt ${taktMs / 1000} s. Beenden mit Ctrl+C.\n`);
  for (;;) {
    await d.takt();
    await new Promise((r) => setTimeout(r, taktMs));
  }
}
