"""Andocken je Projekt und Epic (#112): the setting `merge` of a project and the switch of an epic, both
only with the PIN; the bridge only tightens (automatisch only where the driver offers it, merge.ps1 stays
the hard limit); the Sternenkarte shows the position, its origin and the reason of the proposal."""

import json

from conftest import fremd, koppeln

FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}
NUR_NACH_GATE = 'der Adapter sagt merge: mensch, automatisch andocken geht nur mit merge: nach_gate'


def tafel(c):
    return c.get('/api/tafel').json()


def einstellen(c, wert, pin='4711'):
    body = {'forge': FORGE, 'epic': 0, 'art': 'einstellen', 'nr': None, 'seit': None, 'text': json.dumps({'name': 'merge', 'wert': wert})}
    return c.post('/api/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def schalten(c, epic, text, pin='4711'):
    body = {'forge': FORGE, 'epic': epic, 'art': 'merge', 'nr': None, 'seit': None, 'text': text}
    return c.post('/api/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def offene(c):
    return c.get('/api/handlungen', params={'forge': FORGE}).json()


def karte(c):
    return {e['nr']: e for e in tafel(c)['projekte'][0]['epics']}


def nur_mensch(bericht):
    """A project whose adapter says merge: mensch: the driver offers only mensch and says why."""
    e = next(x for x in bericht['einstellungen'] if x['name'] == 'merge')
    e.update(wert='mensch', standard='mensch', werte=['mensch'], hinweis=NUR_NACH_GATE)
    return bericht


def test_einstellung_annehmen_abholen_und_im_logbuch(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert einstellen(client, 'mensch').json()['ok']
    e = next(x for x in tafel(client)['projekte'][0]['einstellungen'] if x['name'] == 'merge')
    assert (e['titel'], e['wert'], e['werte'], e['offen']['wert']) == ('Andocken', 'automatisch', ['automatisch', 'mensch'], 'mensch')
    geholt = offene(client)
    assert [(h['epic'], h['art'], h['text']) for h in geholt] == [(0, 'einstellen', '{"name": "merge", "wert": "mensch"}')]
    client.post(f"/api/handlungen/{geholt[0]['id']}/quittung")
    x = next(x for x in tafel(client)['erledigt'] if x['art'] == 'handlung')
    assert (x['titel'], x['wert']) == ('Andocken', 'mensch')


def test_einstellung_braucht_ein_geraet_mit_recht(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert einstellen(fremd(client), 'mensch').status_code == 401
    stumm = fremd(client)
    koppeln(stumm, handeln=False)
    assert einstellen(stumm, 'mensch').status_code == 403
    assert offene(client) == []
    assert einstellen(client, 'mensch', pin=None).status_code == 200


def test_einstellung_nur_aus_den_werten_des_treibers(client, bericht):
    client.post('/api/bericht', json=nur_mensch(bericht))
    r = einstellen(client, 'automatisch')
    assert r.status_code == 422
    assert r.json()['detail'] == NUR_NACH_GATE
    for wert in ('nach_gate', None, 1, ['mensch']):
        assert einstellen(client, wert).status_code == 422, wert
    assert einstellen(client, 'mensch').status_code == 200


def test_schalter_am_epic_braucht_ein_geraet_mit_recht(client, bericht, bruecke):
    client.post('/api/bericht', json=bericht)
    assert schalten(fremd(client), 41, 'automatisch').status_code == 401
    stumm = fremd(client)
    koppeln(stumm, handeln=False)
    assert schalten(stumm, 41, 'automatisch').status_code == 403
    assert offene(client) == []
    assert schalten(client, 41, 'automatisch', pin=None).status_code == 200
    c = bruecke(pin='')
    c.post('/api/bericht', json=bericht)
    assert schalten(c, 41, 'mensch').status_code == 403


def test_schalter_annehmen_abholen_und_auf_der_sternenkarte(client, bericht):
    client.post('/api/bericht', json=bericht)
    # the proposal of #41 is overruled, #38 goes back to it; the last switch of an epic counts until fetched
    assert schalten(client, 41, 'mensch').status_code == 200
    assert schalten(client, 41, 'automatisch').status_code == 200
    assert schalten(client, 38, None).status_code == 200
    k = karte(client)
    assert k[41]['merge'] == {'stellung': 'mensch', 'herkunft': 'vorschlag', 'grund': 'Kundentext: „Kunde“ in #50'}
    assert (k[41]['andocken']['art'], k[41]['andocken']['text']) == ('merge', 'automatisch')
    assert k[37]['merge']['herkunft'] == 'epic' and k[37]['andocken'] is None
    assert [(h['epic'], h['art'], h['nr'], h['seit'], h['text']) for h in offene(client)] == [(41, 'merge', None, None, 'automatisch'), (38, 'merge', None, None, None)]


def test_schalter_verschaerft_nur(client, bericht):
    client.post('/api/bericht', json=nur_mensch(bericht))
    r = schalten(client, 41, 'automatisch')
    assert r.status_code == 409
    assert r.json()['detail'] == NUR_NACH_GATE
    assert schalten(client, 41, 'mensch').status_code == 200
    assert schalten(client, 41, None).status_code == 200


def test_schalter_nur_fuer_ein_epic_im_einsatz_mit_gueltigem_wert(client, bericht):
    client.post('/api/bericht', json=bericht)
    for text in ('nach_gate', 'Mensch', 'ja'):
        assert schalten(client, 41, text).status_code == 422, text
    assert schalten(client, 0, 'mensch').status_code == 422
    assert schalten(client, 99, 'mensch').status_code == 404
    assert schalten(client, 35, 'mensch').status_code == 409
    assert offene(client) == []


def test_aelterer_treiber_ohne_andocken(client, bericht):
    for ep in bericht['epics']:
        del ep['merge']
    bericht['einstellungen'] = [e for e in bericht['einstellungen'] if e['name'] != 'merge']
    for e in bericht['einstellungen']:
        e.pop('werte', None)
        e.pop('hinweis', None)
    assert client.post('/api/bericht', json=bericht).status_code == 200
    assert karte(client)[41]['merge'] is None
    assert schalten(client, 41, 'mensch').status_code == 409
    assert offene(client) == []


def test_unbekannte_herkunft_der_stellung_wird_abgelehnt(client, bericht):
    bericht['epics'][0]['merge']['herkunft'] = 'irgendwo'
    assert client.post('/api/bericht', json=bericht).status_code == 422
