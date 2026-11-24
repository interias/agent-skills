# SQLite: the last report per project, when an epic reached its stage, the answers and actions of
# the person until the driver acknowledges them, the prototypes of each project (Holodeck),
# (#37) the push subscriptions of the devices and the events of "Braucht dich" already reported, and (#85)
# the chats of the Bereitschaftsraum: messages, answers and state, never credentials. (#46) The paired
# devices with their rights (only the hash of their key), the emergency stop and the log of what each device did.

import json
import sqlite3
import threading
from pathlib import Path

from .modelle import BEZUG, HANDLUNG_GRUPPE

SCHEMA = """
create table if not exists projekte (
  forge text primary key,
  angelegt text not null,
  empfangen text not null,
  bericht text not null,
  entfernt text,
  entfernt_gestartet text
);
create table if not exists stufen (
  forge text not null,
  nr integer not null,
  stufe text not null,
  seit text not null,
  primary key (forge, nr)
);
create table if not exists antworten (
  id integer primary key autoincrement,
  forge text not null,
  epic integer not null,
  nr integer not null,
  seit text not null,
  option text,
  text text not null,
  zeit text not null,
  abgeholt text,
  quittiert text,
  unique (forge, epic, nr, seit)
);
create table if not exists handlungen (
  id integer primary key autoincrement,
  forge text not null,
  epic integer not null,
  art text not null,
  nr integer,
  seit text,
  text text,
  zeit text not null,
  abgeholt text,
  quittiert text,
  geraet text
);
create table if not exists prototypen (
  forge text not null,
  name text not null,
  titel text not null,
  geaendert text not null,
  inhalt text not null,
  primary key (forge, name)
);
create table if not exists push_abos (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  angelegt text not null
);
create table if not exists gemeldet (
  forge text not null,
  schluessel text not null,
  primary key (forge, schluessel)
);
create table if not exists werft (
  rechner text primary key,
  empfangen text not null,
  bericht text not null
);
create table if not exists werft_handlungen (
  id integer primary key autoincrement,
  rechner text not null,
  forge text not null,
  stack text,
  art text not null,
  text text,
  zeit text not null,
  abgeholt text,
  quittiert text
);
create table if not exists werft_meldungen (
  id integer primary key autoincrement,
  rechner text not null,
  zeit text not null,
  text text not null
);
create table if not exists chats (
  id integer primary key autoincrement,
  forge text not null,
  konto text not null,
  modell text,
  stand text not null default 'offen',
  rechner text,
  sitzung text,
  angelegt text not null,
  geaendert text not null
);
create table if not exists chat_nachrichten (
  id integer primary key autoincrement,
  chat integer not null,
  art text not null,
  text text,
  entwurf text,
  starten integer not null default 0,
  zeit text not null,
  rechner text,
  quittiert text,
  antwort text,
  beantwortet text
);
create table if not exists chat_rechner (
  name text primary key,
  konten text not null,
  gesehen text not null
);
create table if not exists geraete (
  id integer primary key autoincrement,
  name text not null,
  hash text not null unique,
  antworten integer not null default 1,
  handeln integer not null default 0,
  gekoppelt text not null,
  zuletzt text
);
create table if not exists notaus (
  id integer primary key check (id = 1),
  seit text not null,
  geraet text not null
);
create table if not exists geraete_logbuch (
  id integer primary key autoincrement,
  zeit text not null,
  geraet text not null,
  befehl text not null
);
"""
# the entries of the device log the board carries, newest first
LOGBUCH_ZEILEN = 200
# the messages of the Werft kept per machine: its reports carry only those of one takt
WERFT_MELDUNGEN = 40


class Speicher:
    def __init__(self, pfad: str):
        if pfad != ':memory:':
            Path(pfad).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(pfad, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.executescript(SCHEMA)
            # databases of the first version have no option column
            if 'option' not in [z['name'] for z in self.db.execute('pragma table_info(antworten)')]:
                self.db.execute('alter table antworten add column option text')
            # #126: the mark of a removed project and the start of the driver that was asked to halt
            if 'entfernt' not in [z['name'] for z in self.db.execute('pragma table_info(projekte)')]:
                self.db.execute('alter table projekte add column entfernt text')
                self.db.execute('alter table projekte add column entfernt_gestartet text')
            # #46: the device that sent an action
            if 'geraet' not in [z['name'] for z in self.db.execute('pragma table_info(handlungen)')]:
                self.db.execute('alter table handlungen add column geraet text')

    def bericht_speichern(self, forge: str, bericht: dict, jetzt: str) -> bool:
        """Stores the report; True when it created the project."""
        with self.lock, self.db:
            alt = self.db.execute('select entfernt, entfernt_gestartet from projekte where forge = ?', (forge,)).fetchone()
            neu = alt is None
            text = json.dumps(bericht, ensure_ascii=False)
            if neu:
                self.db.execute('insert into projekte (forge, angelegt, empfangen, bericht) values (?, ?, ?, ?)', (forge, jetzt, jetzt, text))
            else:
                self.db.execute('update projekte set empfangen = ?, bericht = ? where forge = ?', (jetzt, text, forge))
            gestartet = (bericht.get('version') or {}).get('gestartet')
            if alt is not None and alt['entfernt'] and gestartet != alt['entfernt_gestartet']:
                # #126: a newly started driver of a removed project brings it back; a removal the old one never fetched does not halt it
                self.db.execute('update projekte set entfernt = null, entfernt_gestartet = null where forge = ?', (forge,))
                self.db.execute("update handlungen set quittiert = ? where forge = ? and art = 'projekt_entfernen' and abgeholt is null and quittiert is null", (jetzt, forge))
            for ep in bericht['epics']:
                alt = self.db.execute('select stufe from stufen where forge = ? and nr = ?', (forge, ep['nr'])).fetchone()
                if alt is None or alt['stufe'] != ep['stufe']:
                    self.db.execute('insert or replace into stufen values (?, ?, ?, ?)', (forge, ep['nr'], ep['stufe'], jetzt))
            return neu

    def projekte(self) -> list[dict]:
        """The list of projects, without the removed ones (#126)."""
        with self.lock:
            zeilen = self.db.execute('select * from projekte where entfernt is null order by forge').fetchall()
        return [{'forge': z['forge'], 'angelegt': z['angelegt'], 'empfangen': z['empfangen'], 'bericht': json.loads(z['bericht'])} for z in zeilen]

    def projekt(self, forge: str) -> dict | None:
        """One project, also a removed one (entfernt: since when, else None)."""
        with self.lock:
            z = self.db.execute('select * from projekte where forge = ?', (forge,)).fetchone()
        return None if z is None else {'forge': z['forge'], 'angelegt': z['angelegt'], 'empfangen': z['empfangen'], 'bericht': json.loads(z['bericht']), 'entfernt': z['entfernt']}

    def entfernt_merken(self, forge: str, gestartet: str | None, jetzt: str) -> None:
        """#126: takes the project out of the list; nothing is deleted. A report of a driver with another start brings it back."""
        with self.lock, self.db:
            self.db.execute('update projekte set entfernt = ?, entfernt_gestartet = ? where forge = ?', (jetzt, gestartet, forge))

    def stufen_seit(self) -> dict[tuple[str, int], str]:
        with self.lock:
            return {(z['forge'], z['nr']): z['seit'] for z in self.db.execute('select * from stufen')}

    def antworten(self, forge: str | None = None, offen: bool = False) -> list[dict]:
        sql = 'select * from antworten where 1 = 1'
        args: list = []
        if forge is not None:
            sql += ' and forge = ?'
            args.append(forge)
        if offen:
            sql += ' and quittiert is null'
        with self.lock:
            return [dict(z) for z in self.db.execute(sql + ' order by id', args)]

    def antwort_setzen(self, forge: str, epic: int, nr: int, seit: str, option: str | None, text: str | None, jetzt: str) -> dict | None:
        """New or changed answer; None when the driver already fetched the old one."""
        with self.lock, self.db:
            alt = self.db.execute('select * from antworten where forge = ? and epic = ? and nr = ? and seit = ?', (forge, epic, nr, seit)).fetchone()
            if alt is not None and (alt['abgeholt'] or alt['quittiert']):
                return None
            # no free text is stored as ''
            if alt is None:
                self.db.execute('insert into antworten (forge, epic, nr, seit, option, text, zeit) values (?, ?, ?, ?, ?, ?, ?)', (forge, epic, nr, seit, option, text or '', jetzt))
            else:
                self.db.execute('update antworten set option = ?, text = ?, zeit = ? where id = ?', (option, text or '', jetzt, alt['id']))
            return dict(self.db.execute('select * from antworten where forge = ? and epic = ? and nr = ? and seit = ?', (forge, epic, nr, seit)).fetchone())

    def abholen(self, forge: str, jetzt: str) -> list[dict]:
        with self.lock, self.db:
            self.db.execute('update antworten set abgeholt = ? where forge = ? and quittiert is null and abgeholt is null', (jetzt, forge))
            return [dict(z) for z in self.db.execute('select * from antworten where forge = ? and quittiert is null order by id', (forge,))]

    def quittieren(self, id_: int, jetzt: str) -> bool:
        with self.lock, self.db:
            r = self.db.execute('update antworten set quittiert = coalesce(quittiert, ?), abgeholt = coalesce(abgeholt, ?) where id = ?', (jetzt, jetzt, id_))
            return r.rowcount > 0

    # ---- actions: requeue, give up, revoke (one open action per epic and target)

    def handlungen(self, forge: str | None = None) -> list[dict]:
        sql, args = 'select * from handlungen', []
        if forge is not None:
            sql, args = sql + ' where forge = ?', [forge]
        with self.lock:
            return [dict(z) for z in self.db.execute(sql + ' order by id', args)]

    def handlung_setzen(self, forge: str, epic: int, art: str, nr: int | None, seit: str | None, text: str | None, jetzt: str, geraet: str | None = None) -> dict | None:
        """New or changed action; None when the driver already fetched an open one for the same target. geraet (#46):
        the name of the device that sent it, for the driver's Flottenlogbuch."""
        with self.lock, self.db:
            if art == 'einstellen':
                # one open change per setting: the last one counts until the driver fetches it
                name = json.loads(text)['name']
                offen = self.db.execute("select * from handlungen where forge = ? and art = 'einstellen' and quittiert is null", (forge,))
                alt = next((z for z in offen if json.loads(z['text'])['name'] == name), None)
            else:
                # einreihen and aufgeben exclude each other, so do pausieren and fortsetzen (#61): the last one
                # of a group counts until the driver fetches it
                gruppe = [a for a, g in HANDLUNG_GRUPPE.items() if g == HANDLUNG_GRUPPE[art]]
                # a revocation or (#116) an answer to a question of the triage points at its question or decision
                ziel = 'art = ? and nr is ? and seit is ?' if art in BEZUG else f"art in ({', '.join('?' * len(gruppe))})"
                ziel_args = [art, nr, seit] if art in BEZUG else gruppe
                alt = self.db.execute(f'select * from handlungen where forge = ? and epic = ? and quittiert is null and {ziel}', [forge, epic, *ziel_args]).fetchone()
            if alt is not None and alt['abgeholt']:
                return None
            if alt is None:
                cur = self.db.execute('insert into handlungen (forge, epic, art, nr, seit, text, zeit, geraet) values (?, ?, ?, ?, ?, ?, ?, ?)', (forge, epic, art, nr, seit, text, jetzt, geraet))
                id_ = cur.lastrowid
            else:
                self.db.execute('update handlungen set art = ?, text = ?, zeit = ?, geraet = ? where id = ?', (art, text, jetzt, geraet, alt['id']))
                id_ = alt['id']
            return dict(self.db.execute('select * from handlungen where id = ?', (id_,)).fetchone())

    def handlungen_abholen(self, forge: str, jetzt: str) -> list[dict]:
        with self.lock, self.db:
            self.db.execute('update handlungen set abgeholt = ? where forge = ? and quittiert is null and abgeholt is null', (jetzt, forge))
            return [dict(z) for z in self.db.execute('select * from handlungen where forge = ? and quittiert is null order by id', (forge,))]

    def handlung_quittieren(self, id_: int, jetzt: str) -> bool:
        with self.lock, self.db:
            r = self.db.execute('update handlungen set quittiert = coalesce(quittiert, ?), abgeholt = coalesce(abgeholt, ?) where id = ?', (jetzt, jetzt, id_))
            return r.rowcount > 0

    # ---- Werft (#90): the last report per machine, its messages, the actions of the person until the Werft acknowledges them

    def werft_speichern(self, bericht: dict, jetzt: str) -> None:
        rechner = bericht['rechner']
        with self.lock, self.db:
            self.db.execute('insert or replace into werft values (?, ?, ?)', (rechner, jetzt, json.dumps(bericht, ensure_ascii=False)))
            self.db.executemany('insert into werft_meldungen (rechner, zeit, text) values (?, ?, ?)', [(rechner, bericht['zeit'], m) for m in bericht['meldungen']])
            self.db.execute('delete from werft_meldungen where rechner = ? and id not in (select id from werft_meldungen where rechner = ? order by id desc limit ?)', (rechner, rechner, WERFT_MELDUNGEN))

    def werft(self) -> list[dict]:
        with self.lock:
            zeilen = self.db.execute('select * from werft order by rechner').fetchall()
            meldungen = [dict(z) for z in self.db.execute('select rechner, zeit, text from werft_meldungen order by id')]
        return [{'rechner': z['rechner'], 'empfangen': z['empfangen'], 'bericht': json.loads(z['bericht']), 'meldungen': [m for m in meldungen if m['rechner'] == z['rechner']]} for z in zeilen]

    def werft_handlungen(self) -> list[dict]:
        with self.lock:
            return [dict(z) for z in self.db.execute('select * from werft_handlungen order by id')]

    def werft_handlung_setzen(self, rechner: str, forge: str, stack: str | None, art: str, text: str | None, jetzt: str) -> dict | None:
        """New or changed action; the last one per target counts until the Werft fetches it (target: the stack and art,
        for einstellen the stack and the setting's name). None when the Werft already fetched an open one."""
        name = json.loads(text)['name'] if art == 'einstellen' else None
        with self.lock, self.db:
            offen = self.db.execute('select * from werft_handlungen where rechner = ? and forge = ? and stack is ? and art = ? and quittiert is null', (rechner, forge, stack, art)).fetchall()
            alt = next((z for z in offen if name is None or json.loads(z['text'])['name'] == name), None)
            if alt is not None and alt['abgeholt']:
                return None
            if alt is None:
                id_ = self.db.execute('insert into werft_handlungen (rechner, forge, stack, art, text, zeit) values (?, ?, ?, ?, ?, ?)', (rechner, forge, stack, art, text, jetzt)).lastrowid
            else:
                self.db.execute('update werft_handlungen set text = ?, zeit = ? where id = ?', (text, jetzt, alt['id']))
                id_ = alt['id']
            return dict(self.db.execute('select * from werft_handlungen where id = ?', (id_,)).fetchone())

    def werft_handlungen_abholen(self, rechner: str, jetzt: str) -> list[dict]:
        with self.lock, self.db:
            self.db.execute('update werft_handlungen set abgeholt = ? where rechner = ? and quittiert is null and abgeholt is null', (jetzt, rechner))
            return [dict(z) for z in self.db.execute('select * from werft_handlungen where rechner = ? and quittiert is null order by id', (rechner,))]

    def werft_handlung_quittieren(self, id_: int, jetzt: str) -> bool:
        with self.lock, self.db:
            r = self.db.execute('update werft_handlungen set quittiert = coalesce(quittiert, ?), abgeholt = coalesce(abgeholt, ?) where id = ?', (jetzt, jetzt, id_))
            return r.rowcount > 0

    # ---- Holodeck (#44): the prototypes the driver sent, delivered only from here

    def prototypen_setzen(self, forge: str, dateien: list[dict]) -> None:
        """The whole set of a project: it replaces the previous one, removed files disappear."""
        with self.lock, self.db:
            self.db.execute('delete from prototypen where forge = ?', (forge,))
            self.db.executemany('insert into prototypen values (?, ?, ?, ?, ?)', [(forge, d['name'], d['titel'], d['geaendert'], d['inhalt']) for d in dateien])

    def prototypen(self) -> list[dict]:
        """Every prototype without its content, for the board."""
        with self.lock:
            return [dict(z) for z in self.db.execute('select forge, name, titel, geaendert from prototypen order by forge, name')]

    def prototyp(self, forge: str, name: str) -> str | None:
        with self.lock:
            z = self.db.execute('select inhalt from prototypen where forge = ? and name = ?', (forge, name)).fetchone()
        return None if z is None else z['inhalt']

    # ---- Web-Push (#37): the subscriptions, and the events of level 1 already reported per project

    def abo_setzen(self, endpoint: str, p256dh: str, auth: str, jetzt: str) -> None:
        with self.lock, self.db:
            self.db.execute('insert or replace into push_abos values (?, ?, ?, ?)', (endpoint, p256dh, auth, jetzt))

    def abo_loeschen(self, endpoint: str) -> bool:
        with self.lock, self.db:
            return self.db.execute('delete from push_abos where endpoint = ?', (endpoint,)).rowcount > 0

    def abos(self) -> list[dict]:
        with self.lock:
            return [dict(z) for z in self.db.execute('select * from push_abos order by angelegt')]

    def neu_gemeldet(self, forge: str, schluessel: list[str]) -> set[str]:
        """The keys not reported before; afterwards the project's reported ones are exactly these (an event gone is forgotten)."""
        with self.lock, self.db:
            alt = {z['schluessel'] for z in self.db.execute('select schluessel from gemeldet where forge = ?', (forge,))}
            self.db.execute('delete from gemeldet where forge = ?', (forge,))
            self.db.executemany('insert or ignore into gemeldet values (?, ?)', [(forge, s) for s in schluessel])
            return set(schluessel) - alt

    # ---- Bereitschaftsraum (#85): chats, their messages and the machines of the chat service

    def chat_rechner_merken(self, name: str, konten: list[str], jetzt: str) -> None:
        with self.lock, self.db:
            self.db.execute('insert or replace into chat_rechner values (?, ?, ?)', (name, ','.join(konten), jetzt))

    def chat_rechner(self) -> list[dict]:
        with self.lock:
            zeilen = self.db.execute('select * from chat_rechner order by name').fetchall()
        return [{'name': z['name'], 'konten': [k for k in z['konten'].split(',') if k], 'gesehen': z['gesehen']} for z in zeilen]

    def chats(self) -> list[dict]:
        with self.lock:
            return [dict(z) for z in self.db.execute('select * from chats order by id')]

    def chat(self, id_: int) -> dict | None:
        with self.lock:
            z = self.db.execute('select * from chats where id = ?', (id_,)).fetchone()
        return None if z is None else dict(z)

    def chat_nachrichten(self) -> list[dict]:
        """Every message, the answer read back from its JSON."""
        with self.lock:
            zeilen = [dict(z) for z in self.db.execute('select * from chat_nachrichten order by id')]
        for z in zeilen:
            z['antwort'] = json.loads(z['antwort']) if z['antwort'] else None
            z['starten'] = bool(z['starten'])
        return zeilen

    def chat_beginnen(self, forge: str, konto: str, modell: str | None, text: str, jetzt: str) -> dict:
        with self.lock, self.db:
            chat = self.db.execute('insert into chats (forge, konto, modell, angelegt, geaendert) values (?, ?, ?, ?, ?)', (forge, konto, modell, jetzt, jetzt)).lastrowid
            id_ = self.db.execute("insert into chat_nachrichten (chat, art, text, zeit) values (?, 'text', ?, ?)", (chat, text, jetzt)).lastrowid
        return {'chat': chat, 'id': id_}

    def chat_einstellen(self, id_: int, konto: str, modell: str | None, jetzt: str) -> str | None:
        """Account and model of a chat; the account only before its first session (a session lives in
        its account). None when set, else the reason."""
        with self.lock, self.db:
            c = self.db.execute('select * from chats where id = ?', (id_,)).fetchone()
            if konto != c['konto'] and c['sitzung'] is not None:
                return 'Das Konto steht fest, seit der Chat eine Sitzung hat.'
            # a machine runs a message on the old account: its session would live there
            if konto != c['konto'] and self.db.execute('select 1 from chat_nachrichten where chat = ? and quittiert is not null and antwort is null', (id_,)).fetchone():
                return 'Ein Rechner arbeitet gerade auf dem bisherigen Konto; das Konto erst nach der Antwort wechseln.'
            self.db.execute('update chats set konto = ?, modell = ?, geaendert = ? where id = ?', (konto, modell, jetzt, id_))
            return None

    def chat_verwerfen(self, id_: int, jetzt: str) -> bool:
        """offen -> verworfen; False when the chat is not open."""
        with self.lock, self.db:
            return self.db.execute("update chats set stand = 'verworfen', geaendert = ? where id = ? and stand = 'offen'", (jetzt, id_)).rowcount > 0

    def chat_schreiben(self, chat: int, text: str, jetzt: str) -> int | None:
        """A text message in an open chat; None when the chat is not open (any more)."""
        with self.lock, self.db:
            if self.db.execute("update chats set geaendert = ? where id = ? and stand = 'offen'", (jetzt, chat)).rowcount == 0:
                return None
            return self.db.execute("insert into chat_nachrichten (chat, art, text, zeit) values (?, 'text', ?, ?)", (chat, text, jetzt)).lastrowid

    def chat_anlegen(self, chat: int, von: int, starten: bool, jetzt: str) -> int | str:
        """An anlegen message with the draft of the chat's latest answer word for word, if that is the
        answer to `von` (the one the person saw). Else the reason as a sentence."""
        with self.lock, self.db:
            c = self.db.execute('select * from chats where id = ?', (chat,)).fetchone()
            if c['stand'] != 'offen':
                return 'Der Chat ist nicht mehr offen.'
            zeilen = self.db.execute('select * from chat_nachrichten where chat = ? order by id', (chat,)).fetchall()
            if any(z['antwort'] is None for z in zeilen):
                return 'Eine Nachricht wartet noch auf ihre Antwort; der Entwurf kann sich noch ändern.'
            mit = [z for z in zeilen if json.loads(z['antwort']).get('entwurf')]
            if not mit:
                return 'Noch kein Entwurf in diesem Chat.'
            if mit[-1]['id'] != von:
                return 'Es gibt einen neueren Entwurf; bitte ansehen und dann anlegen.'
            entwurf = json.loads(mit[-1]['antwort'])['entwurf']
            self.db.execute('update chats set geaendert = ? where id = ?', (jetzt, chat))
            return self.db.execute("insert into chat_nachrichten (chat, art, entwurf, starten, zeit) values (?, 'anlegen', ?, ?, ?)", (chat, entwurf, int(starten), jetzt)).lastrowid

    def chat_offene(self, rechner: str, konten: list[str]) -> list[dict]:
        """The messages without answer this machine may take, oldest first (SCHNITTSTELLE.md, section 8):
        from chats bound to it, and from unbound chats with an account it has, unless another machine
        took the message already. Nothing from a chat that is no longer open."""
        with self.lock:
            zeilen = self.db.execute(
                'select n.*, c.forge, c.konto, c.modell, c.sitzung, c.rechner as gebunden from chat_nachrichten n join chats c on c.id = n.chat'
                " where n.antwort is null and c.stand = 'offen' order by n.id"
            ).fetchall()
        mein = []
        for z in zeilen:
            if z['gebunden'] is not None:
                darf = z['gebunden'] == rechner
            else:
                darf = z['rechner'] == rechner or (z['rechner'] is None and z['konto'] in konten)
            if darf:
                mein.append(dict(z))
        return mein

    def chat_quittieren(self, id_: int, rechner: str, jetzt: str) -> str | None:
        """None: taken by this machine (again). Else 'unbekannt' or the reason for a 409."""
        with self.lock, self.db:
            n = self.db.execute('select * from chat_nachrichten where id = ?', (id_,)).fetchone()
            if n is None:
                return 'unbekannt'
            c = self.db.execute('select * from chats where id = ?', (n['chat'],)).fetchone()
            if c['rechner'] is not None and c['rechner'] != rechner:
                return 'Der Chat gehört einem anderen Rechner.'
            if n['rechner'] is not None:
                return None if n['rechner'] == rechner else 'Ein anderer Rechner hat die Nachricht schon.'
            if c['stand'] != 'offen':
                return 'Der Chat ist nicht mehr offen.'
            if self.db.execute('select 1 from chat_nachrichten where chat = ? and id != ? and quittiert is not null and antwort is null', (n['chat'], id_)).fetchone():
                return 'Im Chat läuft schon eine andere Nachricht.'
            self.db.execute('update chat_nachrichten set rechner = ?, quittiert = ? where id = ?', (rechner, jetzt, id_))
            return None

    def chat_antworten(self, id_: int, antwort: dict, jetzt: str) -> bool:
        """Stores the first answer to a message; a second one changes nothing. False: unknown message.
        The first answer with a session binds the chat to the machine that acknowledged the message; an
        answer to anlegen without fehler and with missions makes the chat angelegt."""
        with self.lock, self.db:
            n = self.db.execute('select * from chat_nachrichten where id = ?', (id_,)).fetchone()
            if n is None:
                return False
            if n['antwort'] is not None:
                return True
            self.db.execute('update chat_nachrichten set antwort = ?, beantwortet = ? where id = ?', (json.dumps(antwort, ensure_ascii=False), jetzt, id_))
            if antwort['sitzung']:
                self.db.execute('update chats set sitzung = ?, rechner = coalesce(rechner, ?) where id = ?', (antwort['sitzung'], n['rechner'], n['chat']))
            if n['art'] == 'anlegen' and antwort['fehler'] is None and antwort.get('missionen'):
                self.db.execute("update chats set stand = 'angelegt' where id = ? and stand = 'offen'", (n['chat'],))
            self.db.execute('update chats set geaendert = ? where id = ?', (jetzt, n['chat']))
            return True

    # ---- devices (#46): only the hash of a device's key is stored, never the key

    def geraet_koppeln(self, name: str, hash_: str, jetzt: str) -> dict:
        """A new device may answer, not act; acting is given on the machine itself."""
        with self.lock, self.db:
            id_ = self.db.execute('insert into geraete (name, hash, gekoppelt) values (?, ?, ?)', (name, hash_, jetzt)).lastrowid
            return self._geraet(self.db.execute('select * from geraete where id = ?', (id_,)).fetchone())

    def geraet(self, hash_: str) -> dict | None:
        with self.lock:
            z = self.db.execute('select * from geraete where hash = ?', (hash_,)).fetchone()
        return None if z is None else self._geraet(z)

    def geraete(self) -> list[dict]:
        with self.lock:
            return [self._geraet(z) for z in self.db.execute('select * from geraete order by id')]

    @staticmethod
    def _geraet(z) -> dict:
        return {'id': z['id'], 'name': z['name'], 'antworten': bool(z['antworten']), 'handeln': bool(z['handeln']), 'gekoppelt': z['gekoppelt'], 'zuletzt': z['zuletzt']}

    def geraet_benutzt(self, id_: int, jetzt: str) -> None:
        with self.lock, self.db:
            self.db.execute('update geraete set zuletzt = ? where id = ?', (jetzt, id_))

    def geraet_rechte(self, id_: int, antworten: bool, handeln: bool) -> bool:
        with self.lock, self.db:
            return self.db.execute('update geraete set antworten = ?, handeln = ? where id = ?', (int(antworten), int(handeln), id_)).rowcount == 1

    def geraet_entkoppeln(self, id_: int) -> bool:
        with self.lock, self.db:
            return self.db.execute('delete from geraete where id = ?', (id_,)).rowcount == 1

    def notaus(self) -> dict | None:
        """Survives a restart of the bridge: it holds until the machine releases it."""
        with self.lock:
            z = self.db.execute('select seit, geraet from notaus').fetchone()
        return None if z is None else dict(z)

    def notaus_setzen(self, geraet: str, jetzt: str) -> None:
        with self.lock, self.db:
            self.db.execute('insert or ignore into notaus (id, seit, geraet) values (1, ?, ?)', (jetzt, geraet))

    def notaus_loesen(self) -> bool:
        with self.lock, self.db:
            return self.db.execute('delete from notaus').rowcount == 1

    def logbuch_schreiben(self, geraet: str, befehl: str, jetzt: str) -> None:
        with self.lock, self.db:
            self.db.execute('insert into geraete_logbuch (zeit, geraet, befehl) values (?, ?, ?)', (jetzt, geraet, befehl))

    def logbuch(self) -> list[dict]:
        with self.lock:
            return [dict(z) for z in self.db.execute('select zeit, geraet, befehl from geraete_logbuch order by id desc limit ?', (LOGBUCH_ZEILEN,))]
