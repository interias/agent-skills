# SQLite: the last report per project, when an epic reached its stage, the answers and actions of
# the person until the driver acknowledges them, the prototypes of each project (Holodeck), and
# (#37) the push subscriptions of the devices and the events of "Braucht dich" already reported.

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
  bericht text not null
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
  quittiert text
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
"""
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

    def bericht_speichern(self, forge: str, bericht: dict, jetzt: str) -> bool:
        """Stores the report; True when it created the project."""
        with self.lock, self.db:
            neu = self.db.execute('select 1 from projekte where forge = ?', (forge,)).fetchone() is None
            text = json.dumps(bericht, ensure_ascii=False)
            if neu:
                self.db.execute('insert into projekte values (?, ?, ?, ?)', (forge, jetzt, jetzt, text))
            else:
                self.db.execute('update projekte set empfangen = ?, bericht = ? where forge = ?', (jetzt, text, forge))
            for ep in bericht['epics']:
                alt = self.db.execute('select stufe from stufen where forge = ? and nr = ?', (forge, ep['nr'])).fetchone()
                if alt is None or alt['stufe'] != ep['stufe']:
                    self.db.execute('insert or replace into stufen values (?, ?, ?, ?)', (forge, ep['nr'], ep['stufe'], jetzt))
            return neu

    def projekte(self) -> list[dict]:
        with self.lock:
            zeilen = self.db.execute('select * from projekte order by forge').fetchall()
        return [{'forge': z['forge'], 'angelegt': z['angelegt'], 'empfangen': z['empfangen'], 'bericht': json.loads(z['bericht'])} for z in zeilen]

    def projekt(self, forge: str) -> dict | None:
        return next((p for p in self.projekte() if p['forge'] == forge), None)

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

    def handlung_setzen(self, forge: str, epic: int, art: str, nr: int | None, seit: str | None, text: str | None, jetzt: str) -> dict | None:
        """New or changed action; None when the driver already fetched an open one for the same target."""
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
                cur = self.db.execute('insert into handlungen (forge, epic, art, nr, seit, text, zeit) values (?, ?, ?, ?, ?, ?, ?)', (forge, epic, art, nr, seit, text, jetzt))
                id_ = cur.lastrowid
            else:
                self.db.execute('update handlungen set art = ?, text = ?, zeit = ? where id = ?', (art, text, jetzt, alt['id']))
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
