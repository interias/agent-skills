# The report of a driver (POST /api/bericht) and the answer of the person. SCHNITTSTELLE.md
# describes every field and where the driver takes it from.

import json
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

EpicStufe = Literal['wartend', 'laeuft', 'frage', 'pr', 'gemergt', 'nacharbeit', 'fertig', 'blockiert', 'abgebrochen']


class Option(BaseModel):
    buchstabe: str = Field(max_length=4)
    text: str = Field(max_length=2000)


class Frage(BaseModel):
    epic: int
    nr: int
    frage: str = Field(max_length=4000)
    lage: str = Field('', max_length=8000)
    optionen: list[Option] = Field([], max_length=26)
    # `— Auswahl: mehrere`: several options at once
    mehrfach: bool = False
    empfehlung: str = Field('', max_length=2000)
    grund: str = Field('', max_length=4000)
    # Betrifft as the run wrote it: 'Lauf', the packages, or ''
    betrifft: str = Field('', max_length=500)
    wartet: str = Field('', max_length=500)
    ganzerLauf: bool = True
    # the question as the run wrote it; the whole block when the driver could not parse it
    roh: str = Field('', max_length=20000)
    # why it lies with the person: the admiral's herkunft and a short mark ('Schema', 'Kosten', ...)
    herkunft: str = Field('', max_length=500)
    marke: str = Field('', max_length=80)
    # can the answer still change until the merge of the epic PR; None: unknown
    umkehrbar: bool | None = None
    # the packages that wait for it ([] when the whole run waits)
    geparkt: list[str] = Field([], max_length=50)
    # identifies the question: numbers start at 1 in every question block
    seit: str = Field(max_length=40)
    beantwortet: str | None = None


class Paket(BaseModel):
    # a child ticket (nr and title, the board links it) or, in spec mode, a package by name
    name: str = Field(max_length=200)
    stand: Literal['offen', 'laeuft', 'fertig', 'geparkt', 'blockiert', 'zurueckgelassen'] = 'offen'
    nr: int | None = None
    titel: str = Field('', max_length=300)
    # first seen working and closed (ISO): the board counts the duration itself
    beginn: str | None = Field(None, max_length=40)
    ende: str | None = Field(None, max_length=40)
    # detail view (#51), from the Agent calls in the run's log; an older driver, spec mode and a package
    # without a call have none. phase: implementer, review, nachbesserung, merge (none once merged)
    phase: Literal['implementer', 'review', 'nachbesserung', 'merge'] | None = None
    runde: int | None = Field(None, ge=1)
    # the class of the latest implementer call, `stufeStart` the one of the first call when it differs
    stufe: Literal['mechanisch', 'standard', 'urteil', 'urteil-hoch'] | None = None
    stufeStart: Literal['mechanisch', 'standard', 'urteil', 'urteil-hoch'] | None = None
    eskaliert: bool | None = None
    # first call, start of the phase, last entry of the log that concerns the package (ISO)
    erstAufruf: str | None = Field(None, max_length=40)
    phaseSeit: str | None = Field(None, max_length=40)
    lebenszeichen: str | None = Field(None, max_length=40)


class Plaetze(BaseModel):
    # packages in implementer, review or nachbesserung; `von` the window of the project adapter (at most 3), None: unknown
    belegt: int = Field(ge=0)
    von: int | None = Field(None, ge=1)


class Spanne(BaseModel):
    # seconds: the forecast shows p50–p90
    p50: float = Field(ge=0)
    p90: float = Field(ge=0)


class Epic(BaseModel):
    nr: int
    titel: str = Field('', max_length=300)
    stufe: EpicStufe
    konto: str | None = Field(None, max_length=100)
    pr: int | None = None
    notiz: str = Field('', max_length=1000)
    geparkt: list[str] = []
    pakete: list[Paket] = []
    schritt: str | None = Field(None, max_length=500)
    schrittZeit: str | None = Field(None, max_length=40)
    gemergtAm: str | None = Field(None, max_length=40)
    # a run process works on it right now (the life sign of level 2)
    prozess: bool = False
    # blocked or aborted: the whole reason, since when, the last events of this epic
    grund: str = Field('', max_length=4000)
    haltZeit: str | None = Field(None, max_length=40)
    log: list[str] = Field([], max_length=40)
    # the person gave it up on the bridge: no longer level 1
    aufgegebenAm: str | None = Field(None, max_length=40)
    # the priority label (prio/hoch): first in the next occupancy, first in "Bereit"
    prio: bool = False
    # times for level 2 (ISO): first run started, joined the merge queue, the driver's gate started
    gestartetAm: str | None = Field(None, max_length=40)
    schlangeSeit: str | None = Field(None, max_length=40)
    gateSeit: str | None = Field(None, max_length=40)
    # forecast of a waiting epic (Prognose), none below the threshold
    prognose: Spanne | None = None
    # order edges (Sternenkarte, #43): the epics of this repository it comes after (`> **Reihenfolge:**`, ## Blocked by); older drivers have none
    nach: list[int] = Field([], max_length=200)
    # detail view (#51): how often the driver started or continued a process after the first start; places in use
    neustarts: int | None = Field(None, ge=0)
    plaetze: Plaetze | None = None


class Fenster(BaseModel):
    # used share in percent and the reset of the window
    verbraucht: float = Field(ge=0, le=1000)
    reset: str = Field(max_length=40)


class Konto(BaseModel):
    konto: str = Field(max_length=100)
    stufe: Literal['gruen', 'gelb', 'rot']
    # the usage windows from the driver's verbrauch.json (5 hours, 7 days) and the age of the value
    fuenf: Fenster | None = None
    woche: Fenster | None = None
    alterMin: float | None = None
    # why the driver brakes this account (only with gelb/rot); the driver cuts it to 4000 characters
    grund: str | None = Field(None, max_length=4000)


class Ereignis(BaseModel):
    zeit: str = Field(max_length=40)
    epic: int | None = None
    text: str = Field(max_length=1000)


class Entscheidung(BaseModel):
    # what the admiral decided himself, or (#52) an answer of the person; (epic, nr, zeit) is the key
    epic: int
    nr: int
    frage: str = Field('', max_length=4000)
    antwort: str = Field('', max_length=4000)
    herkunft: str = Field('', max_length=500)
    grund: str = Field('', max_length=4000)
    einflussreich: bool = False
    zeit: str = Field(max_length=40)
    widerrufen: str | None = Field(None, max_length=4000)
    # who decided (#52): mensch, admiral or lauf (the admiral followed the run); older drivers send none,
    # an unknown word is no reason to refuse the report (the board reads it from herkunft then)
    von: str | None = Field(None, max_length=20)


class Ram(BaseModel):
    stufe: Literal['ok', 'warn', 'hold']
    halt: bool = False
    prozent: float | None = None


class Platte(BaseModel):
    freiGb: float | None = None
    genug: bool = True


class Prognose(BaseModel):
    # zu_wenig: below `ab` measured epics; ungenau: hit rate under 60 %, hidden; ok
    status: Literal['zu_wenig', 'ungenau', 'ok']
    ab: int = Field(ge=1)
    bisher: int = Field(ge=0)
    treffer: int = Field(0, ge=0)
    geprueft: int = Field(0, ge=0)
    # seconds from `berechnet` until the backlog is empty, waits for the person not included
    backlog: Spanne | None = None
    berechnet: str = Field(max_length=40)


class Sitzung(BaseModel):
    """A session of an account (#41), read only: where it runs by the folder name, never the path."""

    konto: str = Field(max_length=100)
    # the last folder name of the working directory; a name with a separator is refused
    projekt: str = Field('', max_length=100, pattern=r'^[^\\/]*$')
    name: str = Field('', max_length=100)
    status: str = Field('', max_length=20)
    kind: str = Field('', max_length=20)
    seit: str = Field('', max_length=40)


class Einstellwert(BaseModel):
    """A setting of the driver that the person can change on the bridge (#58); the limits come from here, the bridge does not know them."""

    name: str = Field(max_length=40)
    titel: str = Field('', max_length=100)
    # a number, a short name, a list of short names or None (where `leer`)
    wert: int | str | list[str] | None = None
    herkunft: Literal['start', 'bruecke', 'standard'] = 'standard'
    seit: str | None = Field(None, max_length=40)
    standard: int | str | list[str] | None = None
    leer: bool = False
    min: int | None = None
    max: int | None = None
    auswahl: list[str] | None = Field(None, max_length=50)


def einstellung_pruefen(liste: list[dict], name: str, wert: Any, andere: dict[str, Any]) -> str | None:
    """Why the driver would refuse the value, or None. `andere`: the value each other setting has or is about to get."""
    e = next((x for x in liste if x['name'] == name), None)
    if e is None:
        return 'Diese Einstellung kennt der Treiber nicht.'
    if wert is None:
        return None if e['leer'] else 'Diese Einstellung braucht einen Wert.'
    auswahl = e.get('auswahl')
    if isinstance(e['wert'], list) or isinstance(e['standard'], list):
        if not isinstance(wert, list) or not all(isinstance(k, str) for k in wert) or len(set(wert)) != len(wert):
            return 'Hier gilt eine Liste von Konten.'
        if any(k not in (auswahl or []) for k in wert):
            return 'Ein Konto davon gibt es auf dem Rechner des Treibers nicht.'
        if name == 'konten' and not wert:
            return 'Mindestens ein Konto muss bleiben.'
        return None
    if auswahl is not None:
        return None if isinstance(wert, str) and wert in auswahl else 'Dieses Konto gibt es auf dem Rechner des Treibers nicht.'
    if isinstance(wert, bool) or not isinstance(wert, int):
        return 'Hier gilt eine ganze Zahl.'
    lo, hi = e.get('min'), e.get('max')
    if (lo is not None and wert < lo) or (hi is not None and wert > hi):
        return f'Erlaubt sind {lo} bis {hi}.'
    gelb, rot = (wert, andere.get('verbrauchRot')) if name == 'verbrauchGelb' else (andere.get('verbrauchGelb'), wert)
    if name in ('verbrauchGelb', 'verbrauchRot') and isinstance(gelb, int) and isinstance(rot, int) and gelb >= rot:
        return 'Gelb muss unter Rot liegen.'
    return None


class Bericht(BaseModel):
    # forge name, owner/name: the first report creates the project
    forge: str = Field(pattern=r'^[\w-][\w.-]*/[\w-][\w.-]*$', max_length=200)
    url: str | None = Field(None, pattern=r'^https?://', max_length=300)
    rechner: str = Field('', max_length=100)
    stand: str = Field(max_length=40)
    aktiv: bool = True
    taktS: int = Field(60, ge=1, le=3600)
    epics: list[Epic] = Field([], max_length=200)
    schlange: list[int] = []
    konten: list[Konto] = []
    ram: Ram | None = None
    platte: Platte | None = None
    obergrenze: int | None = None
    fragen: list[Frage] = Field([], max_length=200)
    # idle limit of a run: the life sign runs out there
    leerlaufS: int | None = Field(None, ge=1)
    # the last events of the driver (the ticker) and the admiral's decisions (level 3)
    ereignisse: list[Ereignis] = Field([], max_length=200)
    entscheidungen: list[Entscheidung] = Field([], max_length=500)
    prognose: Prognose | None = None
    # the sessions of the accounts (`claude agents --json`), the ship list shows them; older drivers have none
    sitzungen: list[Sitzung] = Field([], max_length=500)
    # the settings of the driver (#58), always ten; an older driver has none (None, not [])
    einstellungen: list[Einstellwert] | None = Field(None, max_length=20)


# Holodeck (#44): a file name only, never a path; the bridge resolves it against its own store
PROTOTYP_NAME = r'^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.html$'
PROTOTYPEN_MAX = 50
PROTOTYP_MAX_ZEICHEN = 2 * 1024 * 1024


class Prototyp(BaseModel):
    name: str = Field(pattern=PROTOTYP_NAME, max_length=106)
    titel: str = Field(max_length=300)
    # the file's mtime (ISO)
    geaendert: str = Field(max_length=40)
    inhalt: str = Field(max_length=PROTOTYP_MAX_ZEICHEN)


class Holodeck(BaseModel):
    """The prototypes of a project (POST /api/holodeck): the whole set, it replaces the previous one."""

    forge: str = Field(pattern=r'^[\w-][\w.-]*/[\w-][\w.-]*$', max_length=200)
    dateien: list[Prototyp] = Field([], max_length=PROTOTYPEN_MAX)

    @model_validator(mode='after')
    def namen_einmal(self) -> 'Holodeck':
        namen = [d.name for d in self.dateien]
        if len(namen) != len(set(namen)):
            raise ValueError('Jeder Dateiname nur einmal')
        return self


class Antwort(BaseModel):
    forge: str = Field(max_length=200)
    epic: int
    nr: int
    seit: str = Field(max_length=40)
    # the letter of a chosen option ('A, C' for a multiple choice) and the free text; at least one of them
    option: str | None = Field(None, max_length=80)
    text: str | None = Field(None, max_length=4000)

    @model_validator(mode='after')
    def eins_von_beiden(self) -> 'Antwort':
        self.option = ', '.join(b for b in re.split(r'[\s,;]+', self.option or '') if b) or None
        self.text = (self.text or '').strip() or None
        if not self.option and not self.text:
            raise ValueError('Option oder Freitext')
        return self


class Handlung(BaseModel):
    """What the person asks the driver to do: requeue or give up a blocked epic, revoke a decision, change a setting."""

    forge: str = Field(max_length=200)
    epic: int
    art: Literal['einreihen', 'aufgeben', 'widerruf', 'einstellen']
    # widerruf: the decision (its nr and zeit)
    nr: int | None = None
    seit: str | None = Field(None, max_length=40)
    # widerruf: the new decision, unchanged to the run; einstellen: {"name", "wert"} as JSON
    text: str | None = Field(None, max_length=4000)

    @model_validator(mode='after')
    def widerruf_braucht_bezug(self) -> 'Handlung':
        self.text = (self.text or '').strip() or None
        if self.art == 'widerruf' and (self.nr is None or not self.seit or not self.text):
            raise ValueError('Widerruf: nr, seit und die neue Entscheidung')
        if self.art == 'einstellen':
            # belongs to the project: epic 0; the text is read here once, so the store holds one form
            try:
                d = json.loads(self.text or '')
            except ValueError:
                d = None
            if self.epic != 0 or not isinstance(d, dict) or not isinstance(d.get('name'), str) or 'wert' not in d:
                raise ValueError('Einstellen: epic 0 und text {"name", "wert"}')
            self.nr, self.seit, self.text = None, None, json.dumps({'name': d['name'], 'wert': d['wert']}, ensure_ascii=False)
        elif self.art != 'widerruf':
            self.nr, self.seit, self.text = None, None, None
        return self
