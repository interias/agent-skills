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


# ---- #117: Lernvorschläge

def test_lernvorschlaege_wie_tickets_unter_dem_thema_lernschleife(client, bericht):
    """The driver reports a proposal of the learning loop as a ticket of lern_issue with the topic
    Lernschleife; its extra field lernvorschlag is dropped like any unknown one, the actions work as for tickets."""
    b = copy.deepcopy(bericht)
    kennung = 'Lernvorschlag 555/3'
    b['triage']['tickets'].append({'nr': 119, 'titel': f'{kennung}: Kundenmail', 'labels': ['Lernschleife']})
    b['triage']['fragen'].append({**b['triage']['fragen'][0], 'ticket': 119, 'nr': 1, 'titel': f'{kennung}: Kundenmail', 'seit': '2026-11-22T12:00:00Z', 'lernvorschlag': kennung})
    b['triage']['entscheidungen'].append({'nr': 119, 'titel': 'Lernvorschlag 555/2: Zeittests', 'ergebnis': 'ueberfluessig', 'herkunft': 'h', 'grund': 'g', 'zeit': '2026-11-22T12:00:00.001Z', 'widerrufen': None, 'lernvorschlag': 'Lernvorschlag 555/2'})
    assert client.post('/api/bericht', json=b).status_code == 200
    p = frachtraum(client)[0]
    lern = next(t for t in p['themen'] if t['thema'] == 'Lernschleife')
    assert [(x['nr'], x['titel'], x['issueUrl']) for x in lern['tickets']] == [(119, f'{kennung}: Kundenmail', 'https://github.com/interias/flotte-probe/issues/119')]
    f = next(f for f in p['fragen'] if f['ticket'] == 119)
    assert 'lernvorschlag' not in f
    assert handlung(client, 'triage-antwort', epic=119, nr=1, seit='2026-11-22T12:00:00Z', text=antwort('A')).status_code == 200
    assert handlung(client, 'triage-widerruf', epic=119, seit='2026-11-22T12:00:00.001Z', text='Doch nicht erledigt.').status_code == 200
    assert sorted(h['art'] for h in offene(client)) == ['triage-antwort', 'triage-widerruf']


# ---- #148: the cut plan of the last triage run, a mission revoked

SCHNITT = {'epic': 70, 'text': 'Suche und Filter sind zwei Dinge; erst den Filter allein.'}


@pytest.mark.parametrize('pin', [None, '0000'])
def test_schnitt_widerruf_braucht_die_pin(zwei, pin):
    assert handlung(zwei, 'schnitt-widerruf', pin=pin, **SCHNITT).status_code == 401
    assert offene(zwei) == []


def test_schnitt_widerruf_angenommen_abgeholt_und_unterwegs_an_der_mission(zwei):
    r = handlung(zwei, 'schnitt-widerruf', **SCHNITT)
    assert r.status_code == 200 and r.json()['ok']
    [h] = offene(zwei)
    assert (h['epic'], h['art'], h['nr'], h['seit'], h['text'], h['herkunft']) == (70, 'schnitt-widerruf', None, None, SCHNITT['text'], 'Mensch über die Brücke')
    [m70, m71, m41] = frachtraum(zwei)[0]['schnittplan']['missionen']
    assert m70['handlung']['art'] == 'schnitt-widerruf' and m70['handlung']['abgeholt'] is True
    assert m71['handlung'] is None and m41['handlung'] is None
    assert zwei.post(f"/api/handlungen/{h['id']}/quittung").json() == {'ok': True}
    assert [x['handlung'] for x in zwei.get('/api/tafel').json()['erledigt'] if x['art'] == 'handlung'] == ['schnitt-widerruf']
    # a mission the run only hung a note on can be revoked as well
    assert handlung(zwei, 'schnitt-widerruf', epic=41, text='Englisch kommt später.').status_code == 200


def test_schnitt_widerruf_was_nicht_passt(zwei, bericht):
    # the form: a mission and the objection
    assert handlung(zwei, 'schnitt-widerruf', epic=70).status_code == 422
    assert handlung(zwei, 'schnitt-widerruf', epic=70, text='   ').status_code == 422
    assert handlung(zwei, 'schnitt-widerruf', epic=0, text='nein').status_code == 422
    # a mission not in the plan, another project
    assert handlung(zwei, 'schnitt-widerruf', epic=38, text='nein').status_code == 404
    assert handlung(zwei, 'schnitt-widerruf', forge='interias/notizen', epic=70, text='nein').status_code == 404
    assert offene(zwei) == []
    # revoked already; an open mission the run hung nothing on
    bericht['triage']['schnittplan']['missionen'][0]['widerrufen'] = 'schon'
    bericht['triage']['schnittplan']['missionen'][2]['kinder'] = []
    zwei.post('/api/bericht', json=bericht)
    assert handlung(zwei, 'schnitt-widerruf', **SCHNITT).status_code == 409
    assert handlung(zwei, 'schnitt-widerruf', epic=41, text='nein').status_code == 409
    # an older driver without the plan
    del bericht['triage']['schnittplan']
    zwei.post('/api/bericht', json=bericht)
    assert handlung(zwei, 'schnitt-widerruf', **SCHNITT).status_code == 404
    assert offene(zwei) == []


def test_schnittplan_in_der_tafel(zwei):
    s = frachtraum(zwei)[0]['schnittplan']
    assert s['zeit'] == '2026-11-20T13:04:40Z' and s['fehler'] is None
    m70, m71, m41 = s['missionen']
    assert (m70['nr'], m70['titel'], m70['neu'], m70['zustand'], m70['widerrufbar']) == (70, 'Logbuch durchsuchen und filtern', True, 'frei', True)
    assert m70['begruendung'].startswith('Drei Sternzeit-Notizen')
    assert m70['issueUrl'] == 'https://github.com/interias/flotte-probe/issues/70'
    assert m70['id'] == 'schnitt:interias/flotte-probe#70' and m70['forge'] == FORGE
    assert [(k['nr'], k['titel'], k['issueUrl']) for k in m70['kinder']] == [
        (57, 'Logbuch nach Mission filtern', 'https://github.com/interias/flotte-probe/issues/57'),
        (65, 'Volltextsuche im Logbuch', 'https://github.com/interias/flotte-probe/issues/65'),
    ]
    assert (m71['zustand'], m71['fehler']) == ('fehler', 'Freigabe der Mission #71 gescheitert: HTTP 502')
    assert (m41['neu'], m41['zustand'], m41['issueUrl'], [k['grund'] for k in m41['kinder']]) == (False, 'frei', 'https://github.com/interias/flotte-probe/issues/41', ['Gehört zur Begrüßungsdatei, die Mission hat noch Platz'])
    assert [(n['nr'], n['art'], n['verweis'], n['verweisUrl']) for n in s['notizen']] == [
        (68, 'zusammengefuehrt', 57, 'https://github.com/interias/flotte-probe/issues/57'),
        (58, 'ueberfluessig', None, None),
        (69, 'verworfen', None, None),
    ]
    assert s['notizen'][1]['fundstelle'] == '#43 Sternenkarte'
    # the second project reports no plan
    assert frachtraum(zwei)[1]['schnittplan'] is None


def test_schnittplan_zustaende(client, bericht):
    ms = bericht['triage']['schnittplan']['missionen']
    ms[0]['widerrufen'] = 'zu groß'
    ms[0]['fehler'] = 'Widerruf: Labels an #65 gescheitert: HTTP 502'
    ms[1]['fehler'] = None
    client.post('/api/bericht', json=bericht)
    m70, m71, _ = frachtraum(client)[0]['schnittplan']['missionen']
    assert (m70['zustand'], m70['widerrufbar'], m70['fehler']) == ('widerrufen', False, 'Widerruf: Labels an #65 gescheitert: HTTP 502')
    assert (m71['zustand'], m71['widerrufbar']) == ('offen', True)


def test_bericht_ohne_schnittplan_bleibt_gueltig_und_ungueltiger_ist_422(client, bericht):
    alt = copy.deepcopy(bericht)
    del alt['triage']['schnittplan']
    assert client.post('/api/bericht', json=alt).status_code == 200
    assert frachtraum(client)[0]['schnittplan'] is None
    for weg, wert in [(('notizen', 0, 'art'), 'vielleicht'), (('missionen', 0, 'nr'), 0)]:
        kaputt = copy.deepcopy(bericht)
        x = kaputt['triage']['schnittplan']
        for k in weg[:-1]:
            x = x[k]
        x[weg[-1]] = wert
        assert client.post('/api/bericht', json=kaputt).status_code == 422
    zuviel = copy.deepcopy(bericht)
    zuviel['triage']['schnittplan']['missionen'] *= 7
    assert client.post('/api/bericht', json=zuviel).status_code == 422


# ---- #148: the short info in the head of the project: started, running, ended

def kurzinfo(c, forge=FORGE):
    return next(p for p in frachtraum(c) if p['forge'] == forge)['kurzinfo']


def melde(c, forge=FORGE, **triage):
    b = copy.deepcopy(NOTIZEN)
    b['forge'] = forge
    b['triage'].update(triage)
    assert c.post('/api/bericht', json=b).status_code == 200


def test_kurzinfo_ohne_lauf_ist_leer(zwei):
    assert kurzinfo(zwei, 'interias/notizen') is None


def test_kurzinfo_gestartet_wartet_auf_den_treiber(zwei):
    handlung(zwei, 'triage', forge='interias/notizen')
    assert kurzinfo(zwei, 'interias/notizen') == {'zustand': 'unterwegs', 'seit': '2026-11-20T14:31:10+00:00', 'abgeholt': False, 'fortschritt': None}
    # the driver fetched it, the report does not say "laeuft" yet: still the start, now "abgeholt"
    offene(zwei, 'interias/notizen')
    assert kurzinfo(zwei, 'interias/notizen')['zustand'] == 'unterwegs'
    assert kurzinfo(zwei, 'interias/notizen')['abgeholt'] is True


def test_kurzinfo_laeuft_mit_startzeit_und_fortschritt_nur_wenn_gemeldet(zwei):
    melde(zwei, 'interias/notizen', laeuft=True, seit='2026-11-20T14:30:00Z')
    assert kurzinfo(zwei, 'interias/notizen') == {'zustand': 'laeuft', 'seit': '2026-11-20T14:30:00Z', 'fortschritt': None, 'still': False}
    melde(zwei, 'interias/notizen', laeuft=True, seit='2026-11-20T14:30:00Z', fortschritt={'n': 2, 'm': 5})
    assert kurzinfo(zwei, 'interias/notizen')['fortschritt'] == {'n': 2, 'm': 5}
    # a running report beats the action that started it
    handlung(zwei, 'triage', forge='interias/notizen')
    assert kurzinfo(zwei, 'interias/notizen')['zustand'] == 'laeuft'


def test_kurzinfo_beendet_mit_zaehlern_und_ein_neuer_lauf_loest_es_ab(zwei):
    melde(zwei, 'interias/notizen', beendet={'zeit': '2026-11-20T14:30:00Z', 'epics': 3, 'fragen': 2})
    # the questions are the ones open now (the sample has none), not the count of the run
    assert kurzinfo(zwei, 'interias/notizen') == {'zustand': 'beendet', 'seit': '2026-11-20T14:30:00Z', 'epics': 3, 'fragen': 0, 'gescheitert': False, 'fehler': None}
    # a new run started: the old end is gone
    handlung(zwei, 'triage', forge='interias/notizen')
    assert kurzinfo(zwei, 'interias/notizen')['zustand'] == 'unterwegs'


def test_kurzinfo_beendet_verschwindet_nach_der_frist(zwei, uhr):
    melde(zwei, 'interias/notizen', beendet={'zeit': '2026-11-20T14:30:00Z', 'epics': 3, 'fragen': 2})
    assert kurzinfo(zwei, 'interias/notizen')['zustand'] == 'beendet'
    uhr.t = uhr.t.replace(minute=45, second=0)
    melde(zwei, 'interias/notizen', beendet={'zeit': '2026-11-20T14:30:00Z', 'epics': 3, 'fragen': 2})
    assert kurzinfo(zwei, 'interias/notizen') is None


def test_kurzinfo_fortschritt_und_beendet_pruefen_die_form(zwei):
    b = copy.deepcopy(NOTIZEN)
    b['triage']['fortschritt'] = {'n': 0, 'm': 5}
    assert zwei.post('/api/bericht', json=b).status_code == 422
    b['triage']['fortschritt'] = None
    b['triage']['beendet'] = {'zeit': 'x', 'epics': -1, 'fragen': 0}
    assert zwei.post('/api/bericht', json=b).status_code == 422


def test_kurzinfo_beendet_zaehlt_die_offenen_fragen_auch_aus_fruehren_laeufen(zwei, bericht):
    # the run found no new question, one from an earlier run is still open
    melde(zwei, FORGE, beendet={'zeit': '2026-11-20T14:30:00Z', 'epics': 0, 'fragen': 0}, fragen=bericht['triage']['fragen'])
    assert kurzinfo(zwei)['fragen'] == 1
    # answered: the person's question goes with it from the report
    melde(zwei, FORGE, beendet={'zeit': '2026-11-20T14:30:00Z', 'epics': 0, 'fragen': 0}, fragen=[])
    assert kurzinfo(zwei)['fragen'] == 0


def test_kurzinfo_gescheitert_und_ungueltiger_plan_tragen_den_grund(zwei):
    melde(zwei, 'interias/notizen', beendet={'zeit': '2026-11-20T14:30:00Z', 'epics': 0, 'fragen': 0, 'gescheitert': True, 'fehler': 'kein Konto'})
    k = kurzinfo(zwei, 'interias/notizen')
    assert (k['zustand'], k['gescheitert'], k['fehler']) == ('beendet', True, 'kein Konto')
    melde(zwei, 'interias/notizen', beendet={'zeit': '2026-11-20T14:30:00Z', 'epics': 0, 'fragen': 0, 'fehler': 'Plan ungültig'})
    k = kurzinfo(zwei, 'interias/notizen')
    assert (k['gescheitert'], k['fehler']) == (False, 'Plan ungültig')


def test_kurzinfo_laeuft_bei_stillem_treiber_ist_still(zwei, uhr):
    melde(zwei, 'interias/notizen', laeuft=True, seit='2026-11-20T14:30:00Z')
    assert kurzinfo(zwei, 'interias/notizen')['still'] is False
    uhr.t = uhr.t.replace(minute=50)
    assert kurzinfo(zwei, 'interias/notizen')['still'] is True


def test_kurzinfo_beendet_vertraegt_kleinen_uhrversatz(zwei):
    # the driver's clock runs a minute ahead of the bridge
    melde(zwei, 'interias/notizen', beendet={'zeit': '2026-11-20T14:32:10Z', 'epics': 1, 'fragen': 0})
    assert kurzinfo(zwei, 'interias/notizen')['zustand'] == 'beendet'
