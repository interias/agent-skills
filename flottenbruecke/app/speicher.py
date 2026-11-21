# SQLite: the last report per project, when an epic reached its stage, the answers and actions of
# the person until the driver acknowledges them, and the prototypes of each project (Holodeck).

import json
import sqlite3
import threading
from pathlib import Path

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
"""


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
                # einreihen and aufgeben exclude each other: the last one counts until the driver fetches it
                ziel = 'art = ? and nr is ? and seit is ?' if art == 'widerruf' else "art in ('einreihen', 'aufgeben')"
                ziel_args = [art, nr, seit] if art == 'widerruf' else []
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
