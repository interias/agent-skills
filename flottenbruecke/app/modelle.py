# The report of a driver (POST /api/bericht) and the answer of the person. SCHNITTSTELLE.md
# describes every field and where the driver takes it from.

import json
import re
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, model_validator

EpicStufe = Literal['wartend', 'laeuft', 'frage', 'pr', 'gemergt', 'nacharbeit', 'fertig', 'blockiert', 'abgebrochen']
# the actions that exclude each other until the driver fetches them: the last one of a group counts (#61)
HANDLUNG_GRUPPE = {'einreihen': 'halt', 'aufgeben': 'halt', 'pausieren': 'pause', 'fortsetzen': 'pause', 'prioritaet': 'prioritaet', 'aufnehmen': 'aufnehmen', 'widerruf': 'widerruf', 'einstellen': 'einstellen', 'merge': 'merge', 'triage': 'triage', 'triage-antwort': 'triage-antwort', 'triage-widerruf': 'triage-widerruf', 'schnitt-widerruf': 'schnitt-widerruf', 'einspielen': 'einspielen'}
# #116: the actions that point at one question or decision (nr, seit), not at the whole epic
BEZUG = ('widerruf', 'triage-antwort', 'triage-widerruf')
# #112: how an epic merges (Andocken): the driver after the gate, or a person looks at every PR
STELLUNGEN = ('automatisch', 'mensch')


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
    # a child ticket (nr and title, the board links it) or, in spec mode, a package of the run by name (P<k>, #151)
    name: str = Field(max_length=200)
    stand: Literal['offen', 'laeuft', 'fertig', 'geparkt', 'blockiert', 'zurueckgelassen'] = 'offen'
    nr: int | None = None
    titel: str = Field('', max_length=300)
    # first seen working and closed (ISO): the board counts the duration itself
    beginn: str | None = Field(None, max_length=40)
    ende: str | None = Field(None, max_length=40)
    # detail view (#51), from the Agent calls in the run's log, spec packages too (#151); an older driver and a package
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


class GateLauf(BaseModel):
    # #151, only while a gate runs: the n-th gate run of the run (its call of the gate command) or of the driver, its start (ISO)
    n: int = Field(ge=1)
    seit: str | None = Field(None, max_length=40)


class Spanne(BaseModel):
    # seconds: the forecast shows p50–p90
    p50: float = Field(ge=0)
    p90: float = Field(ge=0)


class Andocken(BaseModel):
    """How an epic merges now (#112): its position, where it comes from (the project's setting, the proposal from its content, the person's switch) and the proposal's reason."""

    stellung: Literal['automatisch', 'mensch']
    herkunft: Literal['projekt', 'vorschlag', 'epic']
    grund: str | None = Field(None, max_length=500)


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
    gateLauf: GateLauf | None = None
    # #61: in the driver's deployment (an older driver: always); paused by the person since; the priority set on the bridge, None: the label's
    imEinsatz: bool = True
    pausiert: str | None = Field(None, max_length=40)
    prioritaet: Literal['hoch', 'normal'] | None = None
    # #112: how it merges now; an older driver has none (no switch then)
    merge: Andocken | None = None


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


class Freigegeben(BaseModel):
    """A released open epic of the forge that is not in the driver's deployment (#61): the person may take it in."""

    nr: int = Field(ge=1)
    titel: str = Field('', max_length=300)


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
    # #112: a choice of words (merge): the ones the driver takes now, and why one is missing
    werte: list[str] | None = Field(None, max_length=10)
    hinweis: str | None = Field(None, max_length=500)


class TriageTicket(BaseModel):
    """An open Sternzeit-Notiz (needs-triage or needs-info) of the forge (#116); the bridge links it from the project's url."""

    nr: int = Field(ge=1)
    titel: str = Field('', max_length=300)
    labels: list[str] = Field([], max_length=50)


class TriageEntscheidung(BaseModel):
    """What a triage run of this driver decided and wrote (#116): released (klar) or closed (ueberfluessig); (nr, zeit) is the key."""

    nr: int = Field(ge=1)
    titel: str = Field('', max_length=300)
    ergebnis: Literal['klar', 'ueberfluessig']
    herkunft: str = Field('', max_length=500)
    grund: str = Field('', max_length=4000)
    zeit: str = Field(max_length=40)
    widerrufen: str | None = Field(None, max_length=4000)


class TriageFrage(BaseModel):
    """A critical question of the triage at a ticket, still without an answer (#116); (ticket, nr, seit) is the key, seit the time of its comment."""

    ticket: int = Field(ge=1)
    nr: int = Field(ge=1)
    titel: str = Field('', max_length=300)
    frage: str = Field(max_length=4000)
    optionen: list[Option] = Field([], max_length=26)
    empfehlung: str = Field('', max_length=2000)
    grund: str = Field('', max_length=4000)
    herkunft: str = Field('', max_length=500)
    marke: str = Field('', max_length=80)
    seit: str = Field(max_length=40)


class SchnittKind(BaseModel):
    """#148: a note the triage run linked to a mission of its cut plan, with the plan's reason."""

    nr: int = Field(ge=1)
    titel: str = Field('', max_length=300)
    grund: str = Field('', max_length=2000)


class SchnittMission(BaseModel):
    """#148: a mission of the cut plan: created by the run (neu) or an open one it hung notes on; nr is the key of schnitt-widerruf."""

    nr: int = Field(ge=1)
    url: str | None = Field(None, max_length=300)
    titel: str = Field('', max_length=300)
    begruendung: str = Field('', max_length=4000)
    neu: bool = False
    kinder: list[SchnittKind] = Field([], max_length=50)
    # neu: the mission carries ready_label; an open one: the run released the notes it hung on it
    freigegeben: bool = False
    fehler: str | None = Field(None, max_length=1000)
    widerrufen: str | None = Field(None, max_length=4000)


class SchnittNotiz(BaseModel):
    """#148: a note the cut plan closed: merged into verweis, superfluous (fundstelle) or rejected."""

    nr: int = Field(ge=1)
    titel: str = Field('', max_length=300)
    art: Literal['zusammengefuehrt', 'ueberfluessig', 'verworfen']
    grund: str = Field('', max_length=4000)
    verweis: int | None = Field(None, ge=1)
    fundstelle: str = Field('', max_length=1000)
    fehler: str | None = Field(None, max_length=1000)


class Schnittplan(BaseModel):
    """#148: the cut plan of the driver's last triage run."""

    zeit: str = Field(max_length=40)
    fehler: str | None = Field(None, max_length=1000)
    missionen: list[SchnittMission] = Field([], max_length=20)
    notizen: list[SchnittNotiz] = Field([], max_length=200)


class TriageAbweichung(BaseModel):
    """#147: a note of the input of a triage run without an allowed end state after it."""

    nr: int = Field(ge=1)
    titel: str = Field('', max_length=300)
    zustand: str = Field('', max_length=300)
    grund: str = Field('', max_length=1000)


class TriageAbschluss(BaseModel):
    """#147: how the driver's last triage run ended: beendet, unvollstaendig (the notes not cleanly worked off) or abgebrochen (grund)."""

    zeit: str = Field(max_length=40)
    zustand: Literal['beendet', 'unvollstaendig', 'abgebrochen']
    geprueft: int = Field(0, ge=0)
    sauber: int = Field(0, ge=0)
    abweichungen: list[TriageAbweichung] = Field([], max_length=200)
    grund: str | None = Field(None, max_length=1000)


class TriageFortschritt(BaseModel):
    """#148: note n of m of the run under way; only a driver that knows it reports it."""

    n: int = Field(ge=1)
    m: int = Field(ge=1)


class TriageBeendet(BaseModel):
    """#148: the end of the driver's last triage run: when, the missions of its cut plan, the questions for the person."""

    zeit: str = Field(max_length=40)
    epics: int = Field(ge=0)
    fragen: int = Field(ge=0)
    # the run failed, or its cut plan was invalid: the reason
    gescheitert: bool = False
    fehler: str | None = Field(None, max_length=1000)


class Triage(BaseModel):
    """The triage state of a project (#116): the open Sternzeit-Notizen, the decisions of the driver's triage runs, the open questions."""

    # when the driver last read the forge; a triage run under way
    gelesen: str | None = Field(None, max_length=40)
    laeuft: bool = False
    # #148: when the run under way started, how far it is (only if known), how the last one ended
    seit: str | None = Field(None, max_length=40)
    fortschritt: TriageFortschritt | None = None
    beendet: TriageBeendet | None = None
    tickets: list[TriageTicket] = Field([], max_length=500)
    entscheidungen: list[TriageEntscheidung] = Field([], max_length=200)
    fragen: list[TriageFrage] = Field([], max_length=200)
    # #148: the cut plan of the last triage run; an older driver has none
    schnittplan: Schnittplan | None = None
    # #147: how the last triage run ended; an older driver has none
    abschluss: TriageAbschluss | None = None


class NeuerStand(BaseModel):
    """#154: the newer commit on main of the source of the driver's skill set, with the title of its pull request."""

    commit: str = Field(pattern=r'^[0-9a-f]{7,40}$')
    datum: str = Field('', max_length=40)
    titel: str = Field('', max_length=300)


class Einspielen(BaseModel):
    """#154: the update the person asked for: since when, and the merges the driver waits for before it halts."""

    seit: str = Field(max_length=40)
    wartetAuf: list[int] = Field([], max_length=50)


class Version(BaseModel):
    """#154: the stand the driver runs: commit and date of its installed skill set (None without stand.json), when it
    was installed and when the driver started; neu a newer main of the source, geprueft when it last asked."""

    commit: str | None = Field(None, pattern=r'^[0-9a-f]{7,40}$')
    datum: str | None = Field(None, max_length=40)
    installiert: str | None = Field(None, max_length=40)
    gestartet: str = Field(max_length=40)
    neu: NeuerStand | None = None
    geprueft: str | None = Field(None, max_length=40)
    einspielen: Einspielen | None = None


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
    if e.get('werte') is not None:
        return None if isinstance(wert, str) and wert in e['werte'] else (e.get('hinweis') or f"Erlaubt ist {' oder '.join(e['werte'])}.")
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
    # #61: released epics outside the deployment (aufnehmen); an older driver has none
    freigegeben: list[Freigegeben] = Field([], max_length=500)
    # #116: the triage state (Frachtraum); an older driver has none
    triage: Triage | None = None
    # #154: the stand of the driver; an older driver has none
    version: Version | None = None


# ---- Werft (#90, agent-skills/ADR-0005): the report of the Werft of a machine and the actions of the person for it

# owner/name of origin on GitHub, else the folder name: never a path
WERFT_FORGE = r'^[\w.-]+(/[\w.-]+)?$'
WERFT_MELDUNG_MAX = 4000
# the interval of a repository the bridge takes: not below the takt of the Werft (15 s), at most a day
ABFRAGE_MIN, ABFRAGE_MAX = 15, 86400


class WerftMigrationen(BaseModel):
    """Which commands of #89 the adapter names for a stack."""

    test: bool = False
    arbeit: bool = False
    sicherung: bool = False


class WerftArbeit(BaseModel):
    """The working migration of a stack (#89): only `wartet` takes a release."""

    zustand: Literal['wartet', 'gesperrt', 'laeuft', 'migriert', 'rot']
    commit: str = Field(max_length=64)
    # the backup by its file name, never a path
    sicherung: str | None = Field(None, max_length=255, pattern=r'^[^/\\]+$')
    pruefsumme: str | None = Field(None, max_length=64)
    zeit: str = Field(max_length=40)


class WerftStack(BaseModel):
    name: str = Field(max_length=100)
    # None: never pulled by the Werft yet
    status: Literal['gruen', 'rot'] | None = None
    commit: str | None = Field(None, max_length=64)
    zeit: str | None = Field(None, max_length=40)
    protokoll: str | None = Field(None, max_length=8000)
    migration: WerftMigrationen = WerftMigrationen()
    arbeit: WerftArbeit | None = None
    # #90: an older Werft has no settings: on
    an: bool = True


class WerftRepo(BaseModel):
    forge: str = Field(max_length=200, pattern=WERFT_FORGE)
    branch: str = Field('main', max_length=200)
    stand: str | None = Field(None, max_length=64)
    geprueft: str | None = Field(None, max_length=40)
    abfrageS: int | float = Field(gt=0)
    # #90: the interval the person set, None: the adapter's; an older Werft reports neither these nor `an`, `migrationTest`
    abfrageGesetzt: int | float | None = None
    an: bool = True
    migrationTest: bool = True
    # git fetch names its own error: cut like a message
    fehler: str | None = None
    stacks: list[WerftStack] = Field([], max_length=50)


class WerftBericht(BaseModel):
    """POST /api/werft: the report of one machine's Werft; it replaces that machine's previous one."""

    rechner: str = Field(max_length=100, pattern=r'^[^/\\]+$')
    zeit: str = Field(max_length=40)
    repos: list[WerftRepo] = Field([], max_length=200)
    # what the takt did or turned down; a long one is cut, never the reason to refuse the report
    meldungen: list[str] = Field([], max_length=200)

    @model_validator(mode='after')
    def meldungen_kuerzen(self) -> 'WerftBericht':
        self.meldungen = [m[:WERFT_MELDUNG_MAX] for m in self.meldungen]
        for r in self.repos:
            r.fehler = r.fehler and r.fehler[:WERFT_MELDUNG_MAX]
        return self


class WerftHandlung(BaseModel):
    """What the person asks the Werft of a machine to do (#90): pull a stack now, release its waiting working
    migration, change a setting (`an` of the repository or a stack, `abfrage_s`, `migration_test`)."""

    rechner: str = Field(max_length=100)
    forge: str = Field(max_length=200)
    stack: str | None = Field(None, max_length=100)
    art: Literal['nachziehen', 'migration_freigeben', 'einstellen']
    text: str | None = Field(None, max_length=4000)

    @model_validator(mode='after')
    def form(self) -> 'WerftHandlung':
        try:
            d = json.loads(self.text) if self.text else None
        except ValueError:
            d = None
        if self.art == 'nachziehen':
            if not self.stack:
                raise ValueError('Nachziehen: ein Stack')
            self.text = None
        elif self.art == 'migration_freigeben':
            felder = ('commit', 'sicherung', 'pruefsumme')
            if not self.stack or not isinstance(d, dict) or not all(isinstance(d.get(k), str) and d[k] for k in felder):
                raise ValueError('Freigabe: ein Stack und text {"commit", "sicherung", "pruefsumme"} der wartenden Migration')
            self.text = json.dumps({k: d[k] for k in felder}, ensure_ascii=False)
        else:
            if not isinstance(d, dict) or 'wert' not in d:
                raise ValueError('Einstellen: text {"name", "wert"}')
            name, wert = d.get('name'), d['wert']
            if name == 'an':
                if not isinstance(wert, bool):
                    raise ValueError('Werft und Stack: an (true) oder aus (false)')
            elif name == 'migration_test':
                if not isinstance(wert, bool) or self.stack:
                    raise ValueError('Test-Migrationen selbst: true oder false, für das Repository')
            elif name == 'abfrage_s':
                if self.stack or (wert is not None and (isinstance(wert, bool) or not isinstance(wert, int) or not ABFRAGE_MIN <= wert <= ABFRAGE_MAX)):
                    raise ValueError(f'Abfrageabstand: ganze Sekunden von {ABFRAGE_MIN} bis {ABFRAGE_MAX} oder null (der Adapter), für das Repository')
            else:
                raise ValueError('Diese Einstellung kennt die Werft nicht.')
            self.text = json.dumps({'name': name, 'wert': wert}, ensure_ascii=False)
        return self


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
    """What the person asks the driver to do: requeue or give up a blocked epic, revoke a decision, change a setting, take an epic in, pause or continue it, set its priority or its merge;
    #116: start a triage run, answer a critical question of the triage, revoke a decision of the triage; #148: revoke a mission of the cut plan;
    #154: install the newest stand and start the driver again."""

    # owner/name; triage: also `alle`, one action per project that reports a triage state; einspielen (#154): also `alle`
    forge: str = Field(max_length=200)
    # the epic; triage-antwort and triage-widerruf: the ticket; schnitt-widerruf: the mission; einstellen, triage and einspielen: 0
    epic: int
    art: Literal['einreihen', 'aufgeben', 'widerruf', 'einstellen', 'aufnehmen', 'pausieren', 'fortsetzen', 'prioritaet', 'merge', 'triage', 'triage-antwort', 'triage-widerruf', 'schnitt-widerruf', 'einspielen']
    # widerruf: the decision (its nr and zeit); triage-antwort: the question (nr, seit); triage-widerruf: the decision (seit = its zeit)
    nr: int | None = None
    seit: str | None = Field(None, max_length=40)
    # widerruf: the new decision, unchanged to the run; einstellen: {"name", "wert"} as JSON; prioritaet: hoch or normal;
    # merge (#112): automatisch or mensch, None back to the proposal; triage-antwort: {"option", "text"} as JSON;
    # triage-widerruf and schnitt-widerruf: the person's objection
    text: str | None = Field(None, max_length=4000)

    @model_validator(mode='after')
    def widerruf_braucht_bezug(self) -> 'Handlung':
        self.text = (self.text or '').strip() or None
        if self.art == 'widerruf' and (self.nr is None or not self.seit or not self.text):
            raise ValueError('Widerruf: nr, seit und die neue Entscheidung')
        if self.art in ('triage', 'einspielen'):
            # belongs to the project like einstellen; einspielen (#154): the bridge sets the text itself
            if self.epic != 0:
                raise ValueError('Triage-Lauf und Einspielen: epic 0')
            self.nr, self.seit, self.text = None, None, None
        elif self.art == 'triage-antwort':
            try:
                d = json.loads(self.text or '')
            except ValueError:
                d = None
            if not isinstance(d, dict) or not isinstance(d.get('option'), (str, type(None))) or not isinstance(d.get('text'), (str, type(None))):
                raise ValueError('Triage-Antwort: text {"option", "text"}')
            option = (d.get('option') or '').strip().upper() or None
            text = (d.get('text') or '').strip()[:4000] or None
            if self.epic < 1 or self.nr is None or self.nr < 1 or not self.seit or (option is not None and not re.fullmatch(r'[A-Z]', option)) or not (option or text):
                raise ValueError('Triage-Antwort: Ticket, Frage (nr, seit) und eine Option oder eigener Text')
            self.text = json.dumps({'option': option, 'text': text}, ensure_ascii=False)
        elif self.art == 'triage-widerruf':
            if self.epic < 1 or not self.seit or not self.text:
                raise ValueError('Widerruf einer Triage-Entscheidung: Ticket, seit (= zeit der Entscheidung) und der Einwand')
            self.nr = None
        elif self.art == 'schnitt-widerruf':
            if self.epic < 1 or not self.text:
                raise ValueError('Widerruf einer Mission des Schnittplans: die Mission und der Einwand')
            self.nr, self.seit = None, None
        elif self.art == 'einstellen':
            # belongs to the project: epic 0; the text is read here once, so the store holds one form
            try:
                d = json.loads(self.text or '')
            except ValueError:
                d = None
            if self.epic != 0 or not isinstance(d, dict) or not isinstance(d.get('name'), str) or 'wert' not in d:
                raise ValueError('Einstellen: epic 0 und text {"name", "wert"}')
            self.nr, self.seit, self.text = None, None, json.dumps({'name': d['name'], 'wert': d['wert']}, ensure_ascii=False)
        elif self.art == 'prioritaet':
            if self.epic < 1 or self.text not in ('hoch', 'normal'):
                raise ValueError('Priorität: eine Mission und hoch oder normal')
            self.nr, self.seit = None, None
        elif self.art == 'merge':
            if self.epic < 1 or (self.text is not None and self.text not in STELLUNGEN):
                raise ValueError('Andocken: eine Mission und automatisch, mensch oder nichts (zurück zum Vorschlag)')
            self.nr, self.seit = None, None
        elif self.art in ('aufnehmen', 'pausieren', 'fortsetzen') and self.epic < 1:
            raise ValueError('Diese Handlung braucht eine Mission')
        elif self.art not in BEZUG:
            self.nr, self.seit, self.text = None, None, None
        return self


class PushSchluessel(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


# #159 Nacharbeit: the push services of Chrome/Android, Firefox, Edge and Safari
PUSH_HOSTS = ('fcm.googleapis.com',)
PUSH_HOST_ENDUNGEN = ('.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com')


class PushAbo(BaseModel):
    """#37: a device's push subscription as PushSubscription.toJSON() gives it; the service only over HTTPS."""

    endpoint: str = Field(pattern=r'^https://', max_length=2000)
    keys: PushSchluessel

    @model_validator(mode='after')
    def nur_bekannte_dienste(self) -> 'PushAbo':
        # the bridge posts to every subscription, so only the push services of the browsers, no target in the LAN
        teile = urlsplit(self.endpoint)
        host = (teile.hostname or '').lower()
        if teile.username is not None or teile.password is not None or teile.port not in (None, 443):
            raise ValueError('Endpunkt ohne Benutzerangaben und nur über Port 443')
        if host not in PUSH_HOSTS and not host.endswith(PUSH_HOST_ENDUNGEN):
            raise ValueError('Endpunkt nur bei einem bekannten Push-Dienst')
        return self


class PushAbmeldung(BaseModel):
    endpoint: str = Field(max_length=2000)
