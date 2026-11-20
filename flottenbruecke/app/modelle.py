# The report of a driver (POST /api/bericht) and the answer of the person. SCHNITTSTELLE.md
# describes every field and where the driver takes it from.

from typing import Literal

from pydantic import BaseModel, Field

EpicStufe = Literal['wartend', 'laeuft', 'frage', 'pr', 'gemergt', 'nacharbeit', 'fertig', 'blockiert', 'abgebrochen']


class Option(BaseModel):
    buchstabe: str = Field(max_length=4)
    text: str = Field(max_length=2000)


class Frage(BaseModel):
    epic: int
    nr: int
    frage: str = Field(max_length=4000)
    lage: str = Field('', max_length=8000)
    optionen: list[Option] = []
    empfehlung: str = Field('', max_length=2000)
    grund: str = Field('', max_length=4000)
    wartet: str = Field('', max_length=500)
    ganzerLauf: bool = True
    # identifies the question: numbers start at 1 in every question block
    seit: str = Field(max_length=40)
    beantwortet: str | None = None


class Paket(BaseModel):
    name: str = Field(max_length=200)
    stand: Literal['offen', 'laeuft', 'fertig', 'geparkt', 'blockiert'] = 'offen'


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


class Konto(BaseModel):
    konto: str = Field(max_length=100)
    # a stage, never a percentage (#28)
    stufe: Literal['gruen', 'gelb', 'rot']


class Ram(BaseModel):
    stufe: Literal['ok', 'warn', 'hold']
    halt: bool = False
    prozent: float | None = None


class Platte(BaseModel):
    freiGb: float | None = None
    genug: bool = True


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


class Antwort(BaseModel):
    forge: str = Field(max_length=200)
    epic: int
    nr: int
    seit: str = Field(max_length=40)
    text: str = Field(min_length=1, max_length=4000)
