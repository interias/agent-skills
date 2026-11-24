"""Steering the epics of a deployment from the bridge (#61): take a released epic in, pause and continue
an epic, set its priority. Accepted only with the PIN and where the report allows it, shown on the
Sternenkarte and in the Schiffsliste, carried to the driver like every other action."""

import pytest

FORGE = 'interias/flotte-probe'
GUELTIG = [(43, 'aufnehmen', None), (38, 'pausieren', None), (39, 'fortsetzen', None), (41, 'prioritaet', 'hoch')]


def tafel(c):
    return c.get('/api/tafel').json()


def steuern(c, epic, art, text=None, pin='4711'):
    body = {'forge': FORGE, 'epic': epic, 'art': art, 'nr': None, 'seit': None, 'text': text}
    return c.post('/api/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def offene(c):
    return c.get('/api/handlungen', params={'forge': FORGE}).json()


def projekt(c):
    return tafel(c)['projekte'][0]


def karte(c):
    return {e['nr']: e for e in projekt(c)['epics']}


@pytest.mark.parametrize('epic, art, text', GUELTIG)
def test_jede_handlung_braucht_die_pin(client, bericht, epic, art, text):
    client.post('/api/bericht', json=bericht)
    assert steuern(client, epic, art, text, pin=None).status_code == 401
    assert steuern(client, epic, art, text, pin='0000').status_code == 401
    assert offene(client) == []


def test_ohne_gesetzte_pin_ist_steuern_abgeschaltet(bruecke, bericht):
    c = bruecke(pin='')
    c.post('/api/bericht', json=bericht)
    for epic, art, text in GUELTIG:
        assert steuern(c, epic, art, text).status_code == 403
    assert offene(c) == []


def test_annahme_abholen_quittieren_und_logbuch(client, bericht):
    client.post('/api/bericht', json=bericht)
    for epic, art, text in GUELTIG:
        assert steuern(client, epic, art, text).json()['ok']
    geholt = offene(client)
    assert [(h['epic'], h['art'], h['nr'], h['seit'], h['text'], h['herkunft']) for h in geholt] == [(e, a, None, None, t, 'Mensch über die Brücke') for e, a, t in GUELTIG]
    for h in geholt:
        assert client.post(f"/api/handlungen/{h['id']}/quittung").json() == {'ok': True}
    assert offene(client) == []
    # acknowledged: "Erledigt heute" and the logbook name each one with its epic
    du = [(x['epic'], x['handlung'], x['text']) for x in tafel(client)['erledigt'] if x['art'] == 'handlung']
    assert sorted(du) == sorted((e, a, t) for e, a, t in GUELTIG)


def test_was_nicht_passt_lehnt_die_bruecke_ab(client, bericht):
    bericht['epics'].append({'nr': 50, 'titel': 'Altes Epic', 'stufe': 'wartend', 'imEinsatz': False})
    client.post('/api/bericht', json=bericht)
    # in the deployment already, or not released
    assert steuern(client, 38, 'aufnehmen').status_code == 409
    assert steuern(client, 99, 'aufnehmen').status_code == 409
    # unknown, merged, not in the deployment
    assert steuern(client, 99, 'pausieren').status_code == 404
    assert steuern(client, 35, 'pausieren').status_code == 409
    assert steuern(client, 50, 'prioritaet', 'hoch').status_code == 409
    # 39 is paused, 38 is not
    assert steuern(client, 39, 'pausieren').status_code == 409
    assert steuern(client, 38, 'fortsetzen').status_code == 409
    # the form: hoch or normal, an epic
    assert steuern(client, 41, 'prioritaet', 'dringend').status_code == 422
    assert steuern(client, 41, 'prioritaet').status_code == 422
    assert steuern(client, 0, 'pausieren').status_code == 422
    assert offene(client) == []


def test_die_letzte_je_gruppe_gilt_bis_zum_abholen(client, bericht):
    client.post('/api/bericht', json=bericht)
    steuern(client, 38, 'prioritaet', 'hoch')
    steuern(client, 38, 'prioritaet', 'normal')
    steuern(client, 38, 'pausieren')
    steuern(client, 43, 'aufnehmen')
    steuern(client, 43, 'aufnehmen')
    assert [(h['epic'], h['art'], h['text']) for h in offene(client)] == [(38, 'prioritaet', 'normal'), (38, 'pausieren', None), (43, 'aufnehmen', None)]
    # fetched: a second change of the same group is 409, another group is free
    assert steuern(client, 38, 'prioritaet', 'hoch').status_code == 409
    assert steuern(client, 40, 'pausieren').status_code == 200


def test_sternenkarte_zeigt_einsatz_pause_prioritaet_und_freigegebene(client, bericht):
    client.post('/api/bericht', json=bericht)
    k = karte(client)
    assert k[39]['pausiert'] == '2026-11-20T14:30:00Z' and k[38]['pausiert'] is None
    assert (k[41]['prio'], k[41]['prioritaet']) == (True, 'hoch')
    assert all(e['imEinsatz'] for e in k.values())
    assert projekt(client)['freigegeben'] == [
        {'nr': 43, 'titel': 'Mini-Mission: Statusseite', 'issueUrl': 'https://github.com/interias/flotte-probe/issues/43', 'handlung': None},
        {'nr': 44, 'titel': 'Spec: Exportskript', 'issueUrl': 'https://github.com/interias/flotte-probe/issues/44', 'handlung': None},
    ]
    # on their way: each in its row, until the driver acknowledges it
    steuern(client, 38, 'pausieren')
    steuern(client, 38, 'prioritaet', 'hoch')
    steuern(client, 43, 'aufnehmen')
    k = karte(client)
    assert (k[38]['pause']['art'], k[38]['pause']['abgeholt'], k[38]['vorrang']['art']) == ('pausieren', False, 'prioritaet')
    assert k[39]['pause'] is None
    assert projekt(client)['freigegeben'][0]['handlung']['art'] == 'aufnehmen'


def test_eine_pause_haengt_nicht_an_der_blockadekarte(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert steuern(client, 40, 'pausieren').status_code == 200
    blockade = next(x for x in tafel(client)['braucht'] if x['art'] == 'blockade')
    assert blockade['epic'] == 40 and blockade['handlung'] is None
    # requeue and the pause are different groups: both stay open
    assert steuern(client, 40, 'einreihen').status_code == 200
    assert sorted(h['art'] for h in offene(client)) == ['einreihen', 'pausieren']


def test_schiffsliste_bekommt_pause_und_prioritaet(client, bericht):
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    # 39 stands in "Braucht dich" first (its question): that card names the pause too
    frage = next(x for x in t['braucht'] if x['art'] == 'frage' and x['epic'] == 39)
    assert (frage['pausiert'], frage['prio']) == ('2026-11-20T14:30:00Z', False)
    lauf = {x['nr']: x for x in t['unterwegs']['laeufe']}
    assert lauf[39]['pausiert'] == '2026-11-20T14:30:00Z' and lauf[38]['pausiert'] is None
    bereit = {x['nr']: x for x in t['unterwegs']['bereit']}
    assert bereit[41]['prio'] is True and bereit[41]['pausiert'] is None


def test_aelterer_treiber_ohne_die_felder(client, bericht):
    for e in bericht['epics']:
        for f in ('imEinsatz', 'pausiert', 'prioritaet'):
            e.pop(f)
    bericht.pop('freigegeben')
    assert client.post('/api/bericht', json=bericht).status_code == 200
    k = karte(client)
    assert all(e['imEinsatz'] and e['pausiert'] is None and e['prioritaet'] is None for e in k.values())
    assert projekt(client)['freigegeben'] == []
    assert steuern(client, 43, 'aufnehmen').status_code == 409
