"""Tag Q: the usage of each mission, also under way. The driver reports per mission `verbrauch` (tokens in four
kinds, a weighted sum, the cache share, the estimated share of the account's weekly limit, per package and role) and
per account the missions of today and of this week. The bridge passes both on to the cards, the history sheet and the
Maschinenraum; an older driver sends neither, and everything stays as before."""

import copy
import re
from pathlib import Path

import pytest
from conftest import BEISPIEL

STATIC = Path(__file__).parent.parent / 'app' / 'static'
APP_JS = (STATIC / 'app.js').read_text(encoding='utf-8')
VERLAUF_JS = (STATIC / 'verlauf.js').read_text(encoding='utf-8')
MR_JS = (STATIC / 'bereiche' / 'maschinenraum.js').read_text(encoding='utf-8')
README = (Path(__file__).parent.parent / 'README.md').read_text(encoding='utf-8')
SCHNITTSTELLE = (Path(__file__).parent.parent / 'SCHNITTSTELLE.md').read_text(encoding='utf-8')

METHODE = 'Wochenanteil des Kontos geteilt durch die gewichteten Tokens aller Missionsläufe auf dem Konto in diesem Wochenfenster'
MARKE = 'Markiert ab dem Doppelten des Mittels vergleichbarer abgeschlossener Missionen'

VERBRAUCH = {
    'stand': '2026-11-20T14:30:00Z',
    'eingabe': 12000, 'cache_schreiben': 180000, 'cache_lesen': 2200000, 'ausgabe': 40000,
    'summe': 2432000, 'gewichtet': 667000, 'cache_quote': 0.917, 'anteil_woche': 3.1,
    'konten': ['Konto 2'],
    'rollen': [
        {'paket': None, 'rolle': 'Orchestrator', 'eingabe': 2000, 'cache_schreiben': 60000, 'cache_lesen': 900000, 'ausgabe': 15000, 'summe': 977000, 'gewichtet': 242000, 'cache_quote': 0.936, 'anteil_woche': 1.1},
        {'paket': '#480', 'rolle': 'Ingenieur', 'eingabe': 8000, 'cache_schreiben': 90000, 'cache_lesen': 1000000, 'ausgabe': 20000, 'summe': 1118000, 'gewichtet': 320500, 'cache_quote': 0.909, 'anteil_woche': 1.5},
    ],
    'warnung': ['Cache-Quote 64 % unter 70 %'],
}


def tafel(c):
    return c.get('/api/tafel').json()


def karten(t):
    u = t['unterwegs']
    return {**{x['nr']: x for x in u['laeufe']}, **{x['nr']: x for x in u['schlange']}}


# ---- the board passes it on


def test_beispielbericht_traegt_verbrauch_auf_die_karten(client, bericht):
    assert client.post('/api/bericht', json=bericht).status_code == 200
    k = karten(tafel(client))
    # a running mission with a mark, one in the queue without, one without any usage (an older driver's shape)
    assert k[39]['verbrauch']['warnung'] and k[39]['verbrauch']['konten'] == ['Konto 2']
    assert k[39]['verbrauch']['rollen'][0] == {**k[39]['verbrauch']['rollen'][0], 'paket': None, 'rolle': 'Orchestrator'}
    assert k[36]['verbrauch']['warnung'] == [] and k[36]['verbrauch']['anteil_woche'] == 2.1
    assert k[38]['verbrauch'] is None


def test_beispielbericht_ist_in_sich_stimmig():
    # the sample is the contract: the sum and the weighted sum follow from the four kinds, the roles add up
    mit = [e['verbrauch'] for e in BEISPIEL['epics'] if e.get('verbrauch')]
    assert mit
    for v in mit:
        for z in [v, *v['rollen']]:
            assert z['summe'] == z['eingabe'] + z['cache_schreiben'] + z['cache_lesen'] + z['ausgabe']
            assert z['gewichtet'] == round(z['eingabe'] + 1.25 * z['cache_schreiben'] + 0.1 * z['cache_lesen'] + 5 * z['ausgabe'])
            assert z['cache_quote'] == round(z['cache_lesen'] / (z['eingabe'] + z['cache_schreiben'] + z['cache_lesen']), 3)
        for f in ('eingabe', 'cache_schreiben', 'cache_lesen', 'ausgabe', 'summe'):
            assert v[f] == sum(r[f] for r in v['rollen'])
    # an account with its missions, and the logbook's event of a finished mission
    assert any(k.get('missionen') for k in BEISPIEL['konten'])
    assert any(e['text'].startswith('Verbrauch der Mission:') for e in BEISPIEL['ereignisse'])


def test_verbrauch_kommt_auf_jede_karte_der_mission(client, bericht):
    for ep in bericht['epics']:
        ep['verbrauch'] = copy.deepcopy(VERBRAUCH)
    assert client.post('/api/bericht', json=bericht).status_code == 200
    t = tafel(client)
    assert karten(t)[38]['verbrauch'] == VERBRAUCH
    assert next(x for x in t['braucht'] if x['art'] == 'blockade')['verbrauch']['summe'] == 2432000


def test_konto_traegt_seine_missionen(client, bericht):
    bericht['konten'][0]['missionen'] = [{'epic': 38, 'heute': {'summe': 1200000, 'anteil': 1.2}, 'woche': {'summe': 2432000, 'anteil': None}}]
    assert client.post('/api/bericht', json=bericht).status_code == 200
    k = {x['konto']: x for x in tafel(client)['konten']}
    kurz = bericht['forge'].split('/')[-1]
    assert k['Konto 1']['missionen'] == [{'epic': 38, 'heute': {'summe': 1200000, 'anteil': 1.2}, 'woche': {'summe': 2432000, 'anteil': None}, 'projekt': kurz}]


def test_konto_vereinigt_die_missionen_zweier_projekte(client, bericht):
    # two projects on one account each report only their own missions: the engine room shows both, by project
    eins = copy.deepcopy(bericht)
    eins['konten'][0]['missionen'] = [{'epic': 38, 'heute': {'summe': 100, 'anteil': None}, 'woche': {'summe': 100, 'anteil': None}}]
    zwei = copy.deepcopy(bericht)
    zwei['forge'] = 'interias/zweites'
    zwei['konten'][0]['missionen'] = [{'epic': 7, 'heute': {'summe': 500, 'anteil': 0.5}, 'woche': {'summe': 900, 'anteil': 0.9}}]
    assert client.post('/api/bericht', json=eins).status_code == 200
    assert client.post('/api/bericht', json=zwei).status_code == 200
    m = {x['konto']: x for x in tafel(client)['konten']}['Konto 1']['missionen']
    assert [(x['projekt'], x['epic']) for x in m] == [('zweites', 7), (eins['forge'].split('/')[-1], 38)]


def test_aelterer_treiber_ohne_verbrauch(client, bericht):
    for ep in bericht['epics']:
        ep.pop('verbrauch', None)
    for k in bericht['konten']:
        k.pop('missionen', None)
    assert client.post('/api/bericht', json=bericht).status_code == 200
    t = tafel(client)
    assert all(x['verbrauch'] is None for x in karten(t).values())
    assert all(k['missionen'] is None for k in t['konten'])


def test_verbrauch_null_und_ohne_schaetzung(client, bericht):
    v = copy.deepcopy(VERBRAUCH)
    v.update(cache_quote=None, anteil_woche=None, warnung=[], rollen=[], konten=[])
    del v['stand']
    bericht['epics'][1]['verbrauch'] = v
    bericht['epics'][2]['verbrauch'] = None
    assert client.post('/api/bericht', json=bericht).status_code == 200
    k = karten(tafel(client))
    assert k[38]['verbrauch']['anteil_woche'] is None and k[38]['verbrauch']['stand'] is None
    assert k[39]['verbrauch'] is None


def _rolle(**x):
    return {**VERBRAUCH['rollen'][1], **x}


GRENZEN = [
    (lambda v: v.update(rollen=[_rolle()] * 200), 200),
    (lambda v: v.update(rollen=[_rolle()] * 201), 422),
    (lambda v: v.update(rollen=[_rolle(rolle='x' * 40)]), 200),
    (lambda v: v.update(rollen=[_rolle(rolle='x' * 41)]), 422),
    # the role is a string, not an enum: a new role of the driver still arrives
    (lambda v: v.update(rollen=[_rolle(rolle='Prüfer'), _rolle(rolle='Subagent'), _rolle(rolle='Neue Rolle')]), 200),
    (lambda v: v.update(rollen=[_rolle(paket='#45-p2')]), 200),
    (lambda v: v.update(konten=['K'] * 10), 200),
    (lambda v: v.update(konten=['K'] * 11), 422),
    (lambda v: v.update(konten=['x' * 101]), 422),
    (lambda v: v.update(warnung=['x' * 300] * 4), 200),
    (lambda v: v.update(warnung=['x'] * 5), 422),
    (lambda v: v.update(warnung=['x' * 301]), 422),
    (lambda v: v.update(eingabe=-1), 422),
    (lambda v: v.update(summe=-1), 422),
    (lambda v: v.update(gewichtet=1.5), 422),
    (lambda v: v.update(cache_quote=1.0), 200),
    (lambda v: v.update(cache_quote=1.01), 422),
    (lambda v: v.update(cache_quote=-0.1), 422),
    (lambda v: v.update(anteil_woche=-0.1), 422),
    (lambda v: v.update(rollen=[_rolle(ausgabe=-5)]), 422),
    (lambda v: v.update(stand='x' * 41), 422),
    (lambda v: v.pop('summe'), 422),
]


@pytest.mark.parametrize('aendern,code', GRENZEN)
def test_grenzen_verbrauch(client, bericht, aendern, code):
    v = copy.deepcopy(VERBRAUCH)
    aendern(v)
    bericht['epics'][1]['verbrauch'] = v
    assert client.post('/api/bericht', json=bericht).status_code == code


MISSION = {'epic': 491, 'heute': {'summe': 1200000, 'anteil': 1.2}, 'woche': {'summe': 2432000, 'anteil': 3.1}}

GRENZEN_KONTO = [
    (lambda: [MISSION] * 200, 200),
    (lambda: [MISSION] * 201, 422),
    (lambda: [{**MISSION, 'heute': {'summe': -1, 'anteil': None}}], 422),
    (lambda: [{**MISSION, 'woche': {'summe': 1, 'anteil': -1}}], 422),
    (lambda: [{**MISSION, 'epic': 0}], 422),
    (lambda: [{'epic': 491}], 200),
    (lambda: None, 200),
]


@pytest.mark.parametrize('missionen,code', GRENZEN_KONTO)
def test_grenzen_konto_missionen(client, bericht, missionen, code):
    bericht['konten'][0]['missionen'] = missionen()
    assert client.post('/api/bericht', json=bericht).status_code == code


# ---- the page draws it


def _fn(js, kopf, ende):
    return js[js.index(kopf):js.index(ende, js.index(kopf))]


def test_zahlformat_deutsch_mit_geschaetztem_anteil():
    # the helpers of the board: Mio and Tsd with a comma, the share always with ≈, the cache in whole percent
    assert 'function tokText(' in APP_JS and 'function anteilText(' in APP_JS and 'function cacheText(' in APP_JS
    z = _fn(APP_JS, 'function tokZahl(', '\n}')
    assert ' Mio`' in z and ' Tsd`' in z and "'de-DE'" in z and 'Tok`' in _fn(APP_JS, 'function tokText(', '\n}')
    assert '≈' in _fn(APP_JS, 'function anteilText(', '\n}')
    assert '`Cache ' in _fn(APP_JS, 'function cacheText(', '\n}')
    # no money anywhere
    for js in (APP_JS, VERLAUF_JS, MR_JS):
        assert not re.search(r'Dollar|USD|€|\$\s?\d+[.,]\d', js)


def test_karte_zeigt_die_zahlzeile_nur_mit_verbrauch():
    lauf = _fn(APP_JS, 'function laufHtml(x) {', '\n}')
    # under the title, which all four forms of the card draw
    assert lauf.count('verbrauchHtml(x)') == 1 and lauf.count('${kopfz}${titel}') == 4
    v = _fn(APP_JS, 'function verbrauchHtml(x) {', '\n}')
    # without usage nothing: the card as before
    assert "if (!v) return ''" in v
    # the mark: the warning tone of the bridge, the reasons visible and in the title
    assert 'warnung' in v and 'v.warnung' in v
    # Konto N becomes KN on the card
    assert 'kontoKurz' in v
    assert "replace(/^Konto (\\d+)$/, 'K$1')" in APP_JS
    # the breakdown in the title
    t = _fn(APP_JS, 'function verbrauchTitel(', '\n}')
    for w in ('Eingabe', 'Cache-Schreiben', 'Cache-Lesen', 'Ausgabe', 'gewichtet'):
        assert w in t
    assert METHODE in APP_JS and MARKE in APP_JS


def test_verlauf_zeigt_die_rollentabelle():
    v = _fn(VERLAUF_JS, 'function verbrauchHtml(x) {', '\n  }')
    assert "if (!x.verbrauch) return ''" in v
    assert '<table' in v and 'Rolle' in v and 'Paket' in v
    assert "Orchestrator: 'Orchestrator (Lagebesprechung, Andocken)'" in VERLAUF_JS
    # the head draws it on desktop and phone
    kopf = _fn(VERLAUF_JS, 'function kopfHtml() {', '\n  }')
    assert kopf.count('verbrauchHtml(x)') == 2
    # no tool breakdown
    assert 'werkzeug' not in v


def test_maschinenraum_zeigt_missionen_je_konto_nur_mit_daten():
    k = _fn(MR_JS, 'const missionenHtml = ', '\n  };')
    assert "if (!k.missionen?.length) return ''" in k
    assert 'heute' in k and 'Woche' in k
    assert 'missionenHtml(k)' in _fn(MR_JS, 'const kontoHtml = ', '\n  };')


def test_hilfetexte_nennen_die_methode():
    for text in (README, SCHNITTSTELLE):
        assert METHODE in text and MARKE in text
    assert 'verbrauch-unterwegs-1440.png' in README and 'verbrauch-maschinenraum-390.png' in README
