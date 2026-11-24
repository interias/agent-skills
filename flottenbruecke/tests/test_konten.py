"""#95: the account actions konto_anlegen, konto_deaktivieren, konto_aktivieren, konto_anmelden, only with the PIN,
fetched by the driver like einstellen; the report carries the accounts with aktiv and their sign-in (kontenListe)."""

import copy

FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}
KONTEN = [
    {'nr': 1, 'name': 'Hauptkonto', 'farbe': '#8FB573', 'aktiv': True, 'anmeldung': 'angemeldet'},
    {'nr': 2, 'name': 'Arbeitspferd', 'farbe': '#D97757', 'aktiv': False, 'anmeldung': 'nicht angemeldet'},
]


def mit_konten(bericht):
    b = copy.deepcopy(bericht)
    b['kontenListe'] = copy.deepcopy(KONTEN)
    return b


def handeln(c, art, epic, text=None, pin='4711'):
    body = {'forge': FORGE, 'epic': epic, 'art': art, 'nr': None, 'seit': None, 'text': text}
    return c.post('/api/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def offene(c):
    return c.get('/api/handlungen', params={'forge': FORGE}).json()


def test_ohne_pin_nichts(client, bericht):
    client.post('/api/bericht', json=mit_konten(bericht))
    for art, epic in (('konto_anlegen', 0), ('konto_deaktivieren', 1), ('konto_aktivieren', 2), ('konto_anmelden', 1)):
        # without or with a wrong PIN: refused; after five failures the lock answers 429
        assert handeln(client, art, epic, pin=None).status_code in (403, 429)
        assert handeln(client, art, epic, pin='0000').status_code in (403, 429)
    assert offene(client) == []


def test_mit_pin_genau_einmal_abgeholt(client, bericht):
    client.post('/api/bericht', json=mit_konten(bericht))
    assert handeln(client, 'konto_anlegen', 0, text='  Vier ', pin='4711').json()['ok']
    assert handeln(client, 'konto_deaktivieren', 1).json()['ok']
    # aktivieren and deaktivieren of one account exclude each other: the last one counts until the driver fetches it
    assert handeln(client, 'konto_aktivieren', 1).json()['ok']
    assert handeln(client, 'konto_anmelden', 2).json()['ok']
    geholt = offene(client)
    assert [(h['epic'], h['art'], h['nr'], h['text']) for h in geholt] == [(0, 'konto_anlegen', None, 'Vier'), (1, 'konto_aktivieren', None, None), (2, 'konto_anmelden', None, None)]
    # fetched: a second one for the same target is 409, after the acknowledgement it is gone
    assert handeln(client, 'konto_anmelden', 2).status_code == 409
    for h in geholt:
        assert client.post(f"/api/handlungen/{h['id']}/quittung").json() == {'ok': True}
    assert offene(client) == []


def test_unbekanntes_konto_abgelehnt(client, bericht):
    client.post('/api/bericht', json=mit_konten(bericht))
    assert handeln(client, 'konto_deaktivieren', 7).status_code == 404
    assert handeln(client, 'konto_anmelden', 0).status_code == 422
    assert handeln(client, 'konto_anlegen', 3).status_code == 422
    assert handeln(client, 'konto_anlegen', 0, text='x' * 61).status_code == 422
    assert offene(client) == []


def test_ohne_kontenliste_im_bericht_409(client, bericht):
    client.post('/api/bericht', json={k: v for k, v in bericht.items() if k != 'kontenListe'})
    assert handeln(client, 'konto_anlegen', 0).status_code == 409
    assert handeln(client, 'konto_anmelden', 1).status_code == 409


def test_bericht_traegt_anmeldestatus_ohne_geheimnis(client, bericht):
    assert client.post('/api/bericht', json=mit_konten(bericht)).status_code == 200
    p = client.get('/api/tafel').json()['projekte'][0]
    assert p['kontenListe'] == KONTEN
    falsch = mit_konten(bericht)
    falsch['kontenListe'][0]['anmeldung'] = 'sk-ant-irgendwas'
    assert client.post('/api/bericht', json=falsch).status_code == 422


def test_erledigt_nennt_das_konto_nicht_eine_mission(client, bericht):
    client.post('/api/bericht', json=mit_konten(bericht))
    assert handeln(client, 'konto_deaktivieren', 2).status_code == 200
    h = offene(client)[0]
    client.post(f"/api/handlungen/{h['id']}/quittung")
    x = next(x for x in client.get('/api/tafel').json()['erledigt'] if x.get('handlung') == 'konto_deaktivieren')
    assert (x['epic'], x['konto']) == (None, 2)
