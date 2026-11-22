"""Frachtraum (#116): the Sternzeit-Notizen of every project, bundled by project and topic, the
decisions of the triage run to read and revoke, the critical questions to answer, and the triage run
to start for one project or all. Every action only with the PIN, carried to the driver like the others."""

import copy
import json
from pathlib import Path

import pytest

FORGE = 'interias/flotte-probe'
NOTIZEN = json.loads((Path(__file__).parent.parent / 'beispiel' / 'bericht-notizen.json').read_text(encoding='utf-8'))
FRAGE = {'epic': 61, 'nr': 1, 'seit': '2026-11-20T13:05:00Z'}
ENTSCHEIDUNG = {'epic': 58, 'seit': '2026-11-20T13:04:30Z'}


def handlung(c, art, forge=FORGE, epic=0, nr=None, seit=None, text=None, pin='4711'):
    body = {'forge': forge, 'epic': epic, 'art': art, 'nr': nr, 'seit': seit, 'text': text}
    return c.post('/api/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def antwort(option=None, text=None):
    return json.dumps({'option': option, 'text': text})


GUELTIG = [
    ('triage', {}),
    ('triage-antwort', {**FRAGE, 'text': antwort('B')}),
    ('triage-widerruf', {**ENTSCHEIDUNG, 'text': 'Brauchen wir noch für den Beamer.'}),
]


def offene(c, forge=FORGE):
    return c.get('/api/handlungen', params={'forge': forge}).json()


def frachtraum(c):
    return c.get('/api/tafel').json()['frachtraum']


@pytest.fixture
def zwei(client, bericht):
    client.post('/api/bericht', json=bericht)
    client.post('/api/bericht', json=copy.deepcopy(NOTIZEN))
    return client


# ---- PIN

@pytest.mark.parametrize('art, felder', GUELTIG)
def test_jede_handlung_braucht_die_pin(zwei, art, felder):
    assert handlung(zwei, art, pin=None, **felder).status_code == 401
    assert handlung(zwei, art, pin='0000', **felder).status_code == 401
    assert offene(zwei) == []
    # the counter test: the right PIN is taken
    assert handlung(zwei, art, **felder).status_code == 200
    assert [h['art'] for h in offene(zwei)] == [art]


def test_ohne_gesetzte_pin_abgeschaltet(bruecke, bericht):
    c = bruecke(pin='')
    c.post('/api/bericht', json=bericht)
    for art, felder in GUELTIG:
        assert handlung(c, art, **felder).status_code == 403
    assert offene(c) == []


# ---- acceptance

def test_annahme_abholen_quittieren(zwei):
    for art, felder in GUELTIG:
        assert handlung(zwei, art, **felder).json()['ok']
    geholt = offene(zwei)
    assert [(h['epic'], h['art'], h['nr'], h['seit'], h['herkunft']) for h in geholt] == [
        (0, 'triage', None, None, 'Mensch über die Brücke'),
        (61, 'triage-antwort', 1, '2026-11-20T13:05:00Z', 'Mensch über die Brücke'),
        (58, 'triage-widerruf', None, '2026-11-20T13:04:30Z', 'Mensch über die Brücke'),
    ]
    assert json.loads(geholt[1]['text']) == {'option': 'B', 'text': None}
    assert geholt[0]['text'] is None
    assert geholt[2]['text'] == 'Brauchen wir noch für den Beamer.'
    for h in geholt:
        assert zwei.post(f"/api/handlungen/{h['id']}/quittung").json() == {'ok': True}
    assert offene(zwei) == []
    du = sorted(x['handlung'] for x in zwei.get('/api/tafel').json()['erledigt'] if x['art'] == 'handlung')
    assert du == ['triage', 'triage-antwort', 'triage-widerruf']


def test_triage_fuer_alle_eine_handlung_je_projekt_mit_triage(zwei, bericht):
    # a third project from an older driver without triage gets none
    alt = copy.deepcopy(NOTIZEN)
    alt['forge'] = 'interias/alt'
    del alt['triage']
    zwei.post('/api/bericht', json=alt)
    r = handlung(zwei, 'triage', forge='alle')
    assert r.status_code == 200 and len(r.json()['ids']) == 2
    assert [h['art'] for h in offene(zwei)] == ['triage']
    assert [h['art'] for h in offene(zwei, 'interias/notizen')] == ['triage']
    assert offene(zwei, 'interias/alt') == []
    # pressed twice before the driver fetches it: still one per project
    handlung(zwei, 'triage', forge='alle')
    assert len(offene(zwei)) == 1 and len(offene(zwei, 'interias/notizen')) == 1


def test_antwort_mit_eigenem_text_oder_beidem(zwei):
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'text': antwort(None, '  Nur an die Testliste, dann an alle.  ')}).status_code == 200
    assert json.loads(frachtraum(zwei)[0]['fragen'][0]['handlung']['text']) == {'option': None, 'text': 'Nur an die Testliste, dann an alle.'}
    # changed before the driver fetches it: the last one counts
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'text': antwort('a', 'mit Abmeldelink')}).status_code == 200
    geholt = offene(zwei)
    assert len(geholt) == 1 and json.loads(geholt[0]['text']) == {'option': 'A', 'text': 'mit Abmeldelink'}
    # fetched: no change any more
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'text': antwort('B')}).status_code == 409


def test_was_nicht_passt_lehnt_die_bruecke_ab(zwei, bericht):
    # the form
    assert handlung(zwei, 'triage', epic=3).status_code == 422
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'text': antwort()}).status_code == 422
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'text': 'B'}).status_code == 422
    assert handlung(zwei, 'triage-antwort', epic=61, nr=None, seit=FRAGE['seit'], text=antwort('B')).status_code == 422
    assert handlung(zwei, 'triage-widerruf', **ENTSCHEIDUNG).status_code == 422
    # unknown project, question, decision, option
    assert handlung(zwei, 'triage', forge='interias/fremd').status_code == 404
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'nr': 2, 'text': antwort('A')}).status_code == 404
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'seit': '2026-11-20T13:00:00Z', 'text': antwort('A')}).status_code == 404
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'text': antwort('C')}).status_code == 422
    assert handlung(zwei, 'triage-widerruf', epic=57, seit=ENTSCHEIDUNG['seit'], text='nein').status_code == 404
    assert offene(zwei) == []
    # a run under way, a decision revoked already, an older driver without triage
    bericht['triage']['laeuft'] = True
    bericht['triage']['entscheidungen'][1]['widerrufen'] = 'schon'
    zwei.post('/api/bericht', json=bericht)
    assert handlung(zwei, 'triage').status_code == 409
    assert handlung(zwei, 'triage-widerruf', **ENTSCHEIDUNG, text='nochmal').status_code == 409
    del bericht['triage']
    zwei.post('/api/bericht', json=bericht)
    assert handlung(zwei, 'triage').status_code == 409
    assert handlung(zwei, 'triage-antwort', **{**FRAGE, 'text': antwort('B')}).status_code == 404
    assert offene(zwei) == []


def test_bericht_ohne_triage_bleibt_gueltig_und_ungueltige_triage_ist_422(client, bericht):
    alt = copy.deepcopy(bericht)
    del alt['triage']
    assert client.post('/api/bericht', json=alt).status_code == 200
    assert frachtraum(client) == []
    kaputt = copy.deepcopy(bericht)
    kaputt['triage']['entscheidungen'][0]['ergebnis'] = 'vielleicht'
    assert client.post('/api/bericht', json=kaputt).status_code == 422
    kaputt = copy.deepcopy(bericht)
    kaputt['triage']['fragen'][0]['ticket'] = 0
    assert client.post('/api/bericht', json=kaputt).status_code == 422


# ---- bundling

def test_buendelung_nach_projekt_und_thema_fragen_oben(zwei):
    fr = frachtraum(zwei)
    # the project with an open question first
    assert [p['forge'] for p in fr] == [FORGE, 'interias/notizen']
    p = fr[0]
    assert p['kurz'] == 'flotte-probe' and p['zahl'] == 5 and p['laeuft'] is False and p['handlung'] is None
    themen = [(t['thema'], [x['nr'] for x in t['tickets']]) for t in p['themen']]
    # the topic of the question first, "ohne Thema" last; a ticket with two topics stands in both;
    # needs-triage, needs-info are no topic
    assert themen == [('kommunikation', [61]), ('doku', [62, 63]), ('oberflaeche', [60, 63]), ('ohne Thema', [64])]
    t61 = p['themen'][0]['tickets'][0]
    assert t61 == {'nr': 61, 'titel': 'Newsletter an alle Kunden zum Release', 'issueUrl': 'https://github.com/interias/flotte-probe/issues/61', 'labels': ['needs-triage', 'kommunikation'], 'themen': ['kommunikation'], 'frage': True}
    # status/* is no topic either
    assert [(t['thema'], [x['nr'] for x in t['tickets']]) for t in fr[1]['themen']] == [('export', [12, 15]), ('suche', [14])]
    assert fr[1]['themen'][0]['tickets'][1]['themen'] == ['export']


def test_fragen_und_entscheidungen_im_projekt(zwei):
    p = frachtraum(zwei)[0]
    [f] = p['fragen']
    assert f['ticket'] == 61 and f['nr'] == 1 and f['seit'] == '2026-11-20T13:05:00Z'
    assert f['issueUrl'] == 'https://github.com/interias/flotte-probe/issues/61'
    assert [o['buchstabe'] for o in f['optionen']] == ['A', 'B']
    # the recommendation names an option by its text: that option is marked
    assert f['empfohlen'] == ['B']
    assert f['marke'] == 'nach außen' and f['handlung'] is None
    # decisions newest first, revocable until revoked
    assert [(d['nr'], d['ergebnis'], d['widerrufbar']) for d in p['entscheidungen']] == [(58, 'ueberfluessig', True), (57, 'klar', True)]
    assert p['entscheidungen'][0]['issueUrl'] == 'https://github.com/interias/flotte-probe/issues/58'


def test_unterwegs_steht_an_frage_entscheidung_und_projekt(zwei):
    for art, felder in GUELTIG:
        handlung(zwei, art, **felder)
    p = frachtraum(zwei)[0]
    assert p['handlung']['art'] == 'triage'
    assert p['fragen'][0]['handlung']['art'] == 'triage-antwort'
    assert json.loads(p['fragen'][0]['handlung']['text']) == {'option': 'B', 'text': None}
    assert p['entscheidungen'][0]['handlung']['art'] == 'triage-widerruf'
    assert p['entscheidungen'][1]['handlung'] is None
    assert frachtraum(zwei)[1]['handlung'] is None
