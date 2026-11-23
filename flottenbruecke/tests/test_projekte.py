"""#126: projekt_hinzufuegen and projekt_entfernen, only with the PIN and only for a project whose driver fetches them.
Entfernen takes the project from the list with a mark (nothing deleted); a newly started driver of it brings it back."""

import copy
import json

FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}


def mit_projekten(bericht, gestartet='2026-11-20T08:00:00Z'):
    b = copy.deepcopy(bericht)
    b['projektHandlungen'] = True
    b['version']['gestartet'] = gestartet
    return b


def handlung(c, art, text=None, forge=FORGE, pin='4711'):
    return c.post('/api/handlung', json={'forge': forge, 'epic': 0, 'art': art, 'text': text}, headers={'X-Bruecke-Pin': pin} if pin else {})


def hinzufuegen(c, ordner='C:\\repos\\neues-projekt', autostart=True, **o):
    return handlung(c, 'projekt_hinzufuegen', json.dumps({'ordner': ordner, 'autostart': autostart}), **o)


def forges(c):
    return [p['forge'] for p in c.get('/api/tafel').json()['projekte']]


def schritt(c):
    return next(s['stand'] for s in c.get('/api/tafel').json()['einrichten']['schritte'] if s['schritt'] == 'projekt')


def test_hinzufuegen_nur_mit_pin_fuer_einen_treiber_der_es_abholt(client, bericht):
    client.post('/api/bericht', json=mit_projekten(bericht))
    assert hinzufuegen(client, pin=None).status_code == 401
    assert hinzufuegen(client, forge='interias/unbekannt').status_code == 404
    r = hinzufuegen(client)
    assert r.json()['ok']
    assert schritt(client) == 'wartet'
    p = client.get('/api/tafel').json()['projekte'][0]
    assert p['meldetProjekte'] is True
    assert p['hinzufuegen']['abgeholt'] is False
    geholt = client.get('/api/handlungen', params={'forge': FORGE}).json()
    assert [(h['epic'], h['art'], json.loads(h['text'])) for h in geholt] == [(0, 'projekt_hinzufuegen', {'ordner': 'C:\\repos\\neues-projekt', 'autostart': True})]


def test_hinzufuegen_abgelehnt_ohne_ordner_zu_lang_oder_aelterer_treiber(client, bericht):
    client.post('/api/bericht', json=mit_projekten(bericht))
    assert hinzufuegen(client, ordner='  ').status_code == 422
    assert hinzufuegen(client, ordner='C:\\' + 'x' * 300).status_code == 422
    assert handlung(client, 'projekt_hinzufuegen', '{"ordner": "C:\\\\r", "autostart": "ja"}').status_code == 422
    assert handlung(client, 'projekt_hinzufuegen', 'kein json').status_code == 422
    alt = copy.deepcopy(bericht)
    alt['forge'] = 'interias/alt'
    del alt['projektHandlungen']
    client.post('/api/bericht', json=alt)
    assert hinzufuegen(client, forge='interias/alt').status_code == 409
    assert handlung(client, 'projekt_entfernen', forge='interias/alt').status_code == 409


def test_entfernen_nimmt_das_projekt_aus_der_liste_und_loescht_nichts(client, bericht, tmp_path):
    client.post('/api/bericht', json=mit_projekten(bericht))
    assert handlung(client, 'projekt_entfernen', pin=None).status_code == 401
    assert handlung(client, 'projekt_entfernen').json()['ok']
    assert FORGE not in forges(client)
    # the driver still fetches it and halts; its last reports (same start) keep the project out of the list
    assert [h['art'] for h in client.get('/api/handlungen', params={'forge': FORGE}).json()] == ['projekt_entfernen']
    client.post('/api/bericht', json=mit_projekten(bericht))
    assert FORGE not in forges(client)
    assert handlung(client, 'projekt_entfernen').status_code == 409
    # nothing deleted: the row of the project and its report stay in the database
    assert FORGE.encode() in (tmp_path / 'b.db').read_bytes()


def test_ein_neu_gestarteter_treiber_bringt_das_projekt_zurueck(client, bericht):
    client.post('/api/bericht', json=mit_projekten(bericht))
    handlung(client, 'projekt_entfernen')
    client.post('/api/bericht', json=mit_projekten(bericht, gestartet='2026-11-21T09:00:00Z'))
    assert FORGE in forges(client)
    # the removal the old driver never fetched does not halt the new one
    assert client.get('/api/handlungen', params={'forge': FORGE}).json() == []
