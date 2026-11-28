# The Klartext display (#246, agent-skills/ADR-0008): the bridge shows the Sprachraum by default; a device may switch to
# the usual developer terms. Every plain term stands in one file, the term table static/klartext.json, which the page
# (static/klartext.js) reads as well. Here the push uses it: fixed texts by their second version (texte), the texts of
# the driver and the runs by word forms with article and case (formen, muster). Never replaced: code in backticks,
# paths and links; titles, answers and project names the caller simply does not pass in.

import json
import re
from pathlib import Path

TABELLE = json.loads((Path(__file__).parent / 'static' / 'klartext.json').read_text(encoding='utf-8'))

# the left column of the table; the Orchestrator keeps its name
LINKS = [s for s, k in TABELLE['begriffe'] if s != k]
# stems a Sprachraum word starts with, also inflected or compounded (Missionen, Andockprüfungen, angedockt)
STAEMME = sorted({w for s in LINKS for w in s.split()} - {'frei', 'Erster'} | {'Außeneinsätz', 'Offizier', 'Andock', 'andock', 'angedockt', 'dockt', 'docken', 'dockte', 'Schnittpläne'}, key=len, reverse=True)
SPRACHRAUM = re.compile(r'(?<![^\W_])(?:' + '|'.join(map(re.escape, STAEMME)) + ')')

# code, links and paths are carried over as they are
GESCHUETZT = re.compile(r'`[^`]*`|https?://\S+|\S*[/\\]\S*')


def _gross(s: str) -> str:
    return s[:1].upper() + s[1:]


def _formen() -> dict[str, str]:
    formen = dict(TABELLE['formen'])
    for s, k in TABELLE['formen']:
        if s[:1].islower() and _gross(s) not in formen:
            formen[_gross(s)] = _gross(k)
    return formen


FORMEN = _formen()
FORM = re.compile(r'(?<![^\W_])(?:' + '|'.join(re.escape(s) + ('' if s.endswith('-') else r'(?![^\W_])') for s in sorted(FORMEN, key=len, reverse=True)) + ')')
MUSTER = [(re.compile(m), e) for m, e in TABELLE['muster']]


def _texte() -> tuple[dict[str, str], list[tuple[re.Pattern, str]]]:
    fest, mit = {}, []
    for s, k in TABELLE['texte'].items():
        if '{}' in s:
            mit.append((re.compile('^' + re.escape(s).replace(r'\{\}', '(.*?)') + '$'), k))
        else:
            fest[s] = k
    return fest, mit


TEXTE, TEXTE_MIT = _texte()


def sprachraum_in(text: str) -> bool:
    """Whether a term of the left column stands in the text (outside code, links and paths)."""
    return any(SPRACHRAUM.search(t) for t in GESCHUETZT.split(text))


def _ersetze_stueck(t: str) -> str:
    for m, e in MUSTER:
        t = m.sub(lambda x: re.sub(r'\$(\d)', lambda g: x.group(int(g.group(1))) or '', e), t)
    return FORM.sub(lambda x: FORMEN[x.group(0)], t)


def ersetze(text: str) -> str:
    """A text of the driver or a run in Klartext: word forms, longest first, code, links and paths untouched."""
    aus, pos = [], 0
    for g in GESCHUETZT.finditer(text):
        aus += [_ersetze_stueck(text[pos:g.start()]), g.group(0)]
        pos = g.end()
    return ''.join(aus + [_ersetze_stueck(text[pos:])])


def fassung(text: str) -> str | None:
    """The second version of a fixed text, or None; {} stands for a part that comes by word forms (a number, a name, a
    text of the driver)."""
    t = ' '.join(text.split())
    if t in TEXTE:
        return TEXTE[t]
    for m, k in TEXTE_MIT:
        x = m.match(t)
        if x:
            teile = iter(x.groups())
            return re.sub(r'\{\}', lambda _: ersetze(next(teile)), k)
    return None


def klartext(text: str) -> str:
    """A fixed text by its second version, else word forms."""
    return fassung(text) or ersetze(text)
