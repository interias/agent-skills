"""#246, agent-skills/ADR-0008: the Klartext display in a browser. A bridge of its own (tests/seite.py) with the example
data; every view of every area is drawn in Klartext and checked against the left column of the term table: visible
text and the attributes a person reads (aria-label, title, placeholder, alt). Left out, as the issue says: titles,
answers, chat, code, paths, links and project names (they stand in [translate="no"], code or kbd). A fixed text of the
bridge must come by its second version (texte); word forms are for the texts of the driver and the runs only."""
import json
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from app import klartext
from seite import BEISPIEL, bruecke, chat_fuellen, fuellen, koppeln
from test_klartext import test_treibertexte_mit_artikel_und_fall as _faelle

ANSICHTEN = ['bruecke', 'holodeck', 'frachtraum', 'bereitschaftsraum', 'sternenkarte', 'maschinenraum/betrieb', 'maschinenraum/einstellungen', 'maschinenraum/einrichtung', 'logbuch']

# the texts of driver and runs in the example data: only these may come by word forms
def _treibertexte() -> list[str]:
    aus = []

    def sammle(x):
        if isinstance(x, dict):
            for v in x.values():
                sammle(v)
        elif isinstance(x, list):
            for v in x:
                sammle(v)
        elif isinstance(x, str):
            aus.append(x)

    for datei in BEISPIEL.glob('*.json'):
        sammle(json.loads(datei.read_text(encoding='utf-8')))
    return aus


TREIBER = sorted(set(_treibertexte()), key=len, reverse=True)
# issue titles of the example data that carry a term: they stay in Klartext
TITEL = sorted({t for t in TREIBER if t.startswith('Mini-Mission')})

# everything a person reads on the page, without what stays as it is
SAMMELN = """(alles) => {
  const NIE = alles ? 'script, style' : '[translate="no"], code, pre, kbd, samp, script, style, textarea';
  const aus = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (n.data.trim() && !n.parentElement.closest(NIE)) aus.push(n.data.trim());
    } else if (!n.closest(NIE)) {
      for (const a of ['aria-label', 'title', 'placeholder', 'alt', 'aria-description']) if (n.getAttribute(a)) aus.push(n.getAttribute(a));
    }
  }
  return aus;
}"""

# open what a person can open: every <details>, the info texts, the ship list, the history of the first mission
AUFKLAPPEN = """() => {
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  document.querySelectorAll('[hidden].mr-info-text, .mr-offen[hidden]').forEach((e) => { e.hidden = false; });
}"""


@pytest.fixture(scope='module')
def welt():
    with bruecke() as (basis, am_rechner), sync_playwright() as pw:
        fuellen(basis)
        cookie = koppeln(basis)
        chat_fuellen(basis, cookie)
        browser = pw.chromium.launch()
        yield {'basis': basis, 'am_rechner': am_rechner, 'cookie': cookie, 'browser': browser}
        browser.close()


def _seite(welt, basis=None, cookie=None, breite=1440):
    ctx = welt['browser'].new_context(viewport={'width': breite, 'height': 900}, locale='de-DE')
    basis = basis or welt['basis']
    if cookie:
        name, wert = cookie.split('=', 1)
        ctx.add_cookies([{'name': name, 'value': wert, 'url': basis}])
    seite = ctx.new_page()
    fehler = []
    seite.on('pageerror', lambda e: fehler.append(str(e)))
    seite.goto(basis + '/#bruecke')
    seite.wait_for_function('() => typeof klartext === "object" && klartext.bereit() && document.querySelector("#e1-liste").children.length > 0')
    return seite, fehler


def _anzeige(seite, modus):
    seite.evaluate(f"() => klartext.setzen('{modus}')")
    seite.wait_for_function(f"() => document.documentElement.dataset.anzeige === '{modus}'")


def _alle_ansichten(seite, alles=False):
    gesehen = {}
    for a in ANSICHTEN:
        seite.evaluate(f"() => {{ location.hash = '{a}'; }}")
        seite.wait_for_timeout(150)
        seite.evaluate(AUFKLAPPEN)
        seite.evaluate("() => { const b = document.getElementById('seite-auf'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); }")
        seite.wait_for_timeout(150)
        gesehen[a] = seite.evaluate(SAMMELN, alles)
    return gesehen


def _luecken(seite):
    """Fixed texts that came by word forms: a text the page replaced by formen that still carries a term once the
    driver texts of the example data are taken out of it (a driver text with a fixed '· Konto 1' is fine)."""
    aus = set()
    for p in seite.evaluate('() => klartext.protokoll'):
        if p['wie'] != 'formen':
            continue
        rest = p['roh']
        for t in TREIBER:
            if len(t) > 3 and t in rest:
                rest = rest.replace(t, ' ')
        if klartext.sprachraum_in(rest):
            aus.add(p['roh'])
    return sorted(aus)


@pytest.mark.parametrize('breite', [1440, 390])
def test_kein_sprachraum_im_klartext_in_jeder_ansicht(welt, breite):
    for basis in (welt['basis'], welt['am_rechner']):
        seite, fehler = _seite(welt, basis, welt['cookie'], breite)
        _anzeige(seite, 'klartext')
        rest = {a: sorted({t for t in texte if klartext.sprachraum_in(t)}) for a, texte in _alle_ansichten(seite).items()}
        assert {a: r for a, r in rest.items() if r} == {}
        assert _luecken(seite) == []
        assert fehler == []
        _anzeige(seite, 'sprachraum')
        seite.context.close()


def test_ein_titel_mit_mission_bleibt_wo_er_steht(welt):
    """Every issue title of the example data that carries "Mission" stands as often in Klartext as in the Sprachraum."""
    seite, _ = _seite(welt, cookie=welt['cookie'])
    zaehle = lambda g: {t: sum(x.count(t) for a in g.values() for x in a) for t in TITEL}  # noqa: E731
    _alle_ansichten(seite)  # once around: every view drawn, every <details> open
    vorher = zaehle(_alle_ansichten(seite, True))
    _anzeige(seite, 'klartext')
    nachher = zaehle(_alle_ansichten(seite, True))
    assert TITEL and all(vorher.values())
    assert nachher == vorher
    _anzeige(seite, 'sprachraum')
    seite.context.close()


def test_titel_antworten_und_projektnamen_bleiben(welt):
    seite, _ = _seite(welt, cookie=welt['cookie'])
    _anzeige(seite, 'klartext')
    seite.evaluate("() => { location.hash = 'sternenkarte'; }")
    seite.wait_for_timeout(200)
    text = seite.inner_text('main')
    # an issue title with "Mission" stays
    assert 'Mini-Mission: Konfigurationsdatei' in text
    seite.evaluate("() => { location.hash = 'bereitschaftsraum'; }")
    seite.wait_for_timeout(200)
    # the chat speaks as it spoke
    assert 'Die Probe soll eine Seite mit den letzten Läufen bekommen.' in seite.inner_text('main')
    seite.context.close()


def test_zurueck_zum_sprachraum_stellt_alles_wieder_her(welt):
    """Back in the Sprachraum no text the page replaced stays replaced; the terms are back."""
    seite, _ = _seite(welt, cookie=welt['cookie'])
    _alle_ansichten(seite)
    vorher = {t for a in _alle_ansichten(seite).values() for t in a}
    _anzeige(seite, 'klartext')
    _alle_ansichten(seite)
    # what the page wrote in Klartext and the Sprachraum never shows (not 'Chat', which both show)
    klar = {p['klar'] for p in seite.evaluate('() => klartext.protokoll') if p['klar'] != p['roh']} - vorher
    _anzeige(seite, 'sprachraum')
    nachher = _alle_ansichten(seite)
    alle = [t for a in nachher.values() for t in a]
    assert klar and not [t for t in alle if t in klar]
    assert 'Maschinenraum' in alle and any('Andockprüfung' in t for t in alle)
    seite.context.close()


def test_standard_ist_sprachraum_und_ein_fremdes_geraet_waehlt_im_browser(welt):
    seite, _ = _seite(welt)
    assert seite.evaluate('() => klartext.modus()') == 'sprachraum'
    assert 'Maschinenraum' in seite.text_content('nav.pillen').replace('­', '')
    seite.evaluate("() => { location.hash = 'maschinenraum/einrichtung'; }")
    seite.click('[data-anzeige="klartext"]')
    seite.wait_for_function("() => document.documentElement.dataset.anzeige === 'klartext'")
    assert seite.evaluate("() => localStorage.getItem('flottenbruecke-anzeige')") == 'klartext'
    seite.reload()
    seite.wait_for_function("() => typeof klartext === `object` && klartext.bereit() && document.documentElement.dataset.anzeige === 'klartext'")
    assert 'Maschinenraum' not in seite.text_content('nav.pillen').replace('­', '')
    seite.context.close()


def test_gekoppeltes_geraet_folgt_der_bruecke(welt):
    from seite import koppeln as neu_koppeln
    cookie = neu_koppeln(welt['basis'], 'Zweitgerät')
    seite, _ = _seite(welt, cookie=cookie)
    seite.evaluate("() => { location.hash = 'maschinenraum/einrichtung'; }")
    seite.click('[data-anzeige="klartext"]')
    seite.wait_for_function("() => document.documentElement.dataset.anzeige === 'klartext'")
    # kept in the bridge for this device, not only in the browser
    tafel = seite.evaluate("() => fetch('/api/tafel').then((r) => r.json())")
    assert tafel['geraet']['anzeige'] == 'klartext'
    seite.context.close()


def test_suche_findet_beide_wortschaetze(welt):
    seite, _ = _seite(welt, cookie=welt['cookie'])
    for modus in ('sprachraum', 'klartext'):
        _anzeige(seite, modus)
        for wort in ('Holodeck', 'Prototypen', 'Maschinenraum', 'System'):
            seite.fill('#suche', wort)
            seite.wait_for_timeout(50)
            treffer = seite.evaluate("() => [...document.querySelectorAll('#suche-treffer [role=option]')].map((li) => li.textContent)")
            assert treffer, (modus, wort)
    seite.context.close()


def test_seite_und_push_ersetzen_gleich(welt):
    seite, _ = _seite(welt)
    faelle = [m.args for m in _faelle.pytestmark if m.name == 'parametrize'][0][1]
    for sprachraum, erwartet in faelle:
        assert seite.evaluate('(s) => klartext.ersetze(s)', sprachraum) == erwartet == klartext.ersetze(sprachraum)
    seite.context.close()
