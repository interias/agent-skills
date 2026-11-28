"""#96: the accounts in the Maschinenraum and the guided start. The board carries kontenListe (per machine and
account, with the open action) and einrichten (the four steps with their state); an empty bridge is not set up."""

import copy

FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}


def mit_konten(bericht, *konten):
    b = copy.deepcopy(bericht)
    b['kontenListe'] = list(konten)
    return b


def konto(nr, anmeldung='angemeldet', aktiv=True):
    return {'nr': nr, 'name': f'Konto {nr}', 'farbe': '#112233', 'aktiv': aktiv, 'anmeldung': anmeldung}


def schritte(t):
    return [(s['schritt'], s['stand']) for s in t['einrichten']['schritte']]


def test_leere_bruecke_braucht_die_vier_schritte(client):
    t = client.get('/api/tafel').json()
    assert schritte(t) == [('konto', 'offen'), ('anmeldung', 'offen'), ('forge', 'offen'), ('projekt', 'offen')]
    assert t['einrichten']['fertig'] is False
    assert t['kontenListe'] == []


def test_mit_konto_forge_und_projekt_eingerichtet(client, bericht):
    client.post('/api/bericht', json=mit_konten(bericht, konto(1), konto(2, 'nicht angemeldet', aktiv=False)))
    t = client.get('/api/tafel').json()
    assert schritte(t) == [('konto', 'fertig'), ('anmeldung', 'fertig'), ('forge', 'fertig'), ('projekt', 'fertig')]
    assert t['einrichten']['fertig'] is True
    assert [(k['nr'], k['aktiv'], k['anmeldung'], k['forge']) for k in t['kontenListe']] == [(1, True, 'angemeldet', FORGE), (2, False, 'nicht angemeldet', FORGE)]


def test_kein_konto_angemeldet_und_offene_handlungen_warten_auf_den_rechner(client, bericht):
    client.post('/api/bericht', json=mit_konten(bericht, konto(1, 'nicht angemeldet')))
    assert client.post('/api/handlung', json={'forge': FORGE, 'epic': 1, 'art': 'konto_anmelden'}, headers=PIN).status_code == 200
    t = client.get('/api/tafel').json()
    assert dict(schritte(t))['anmeldung'] == 'wartet'
    assert t['einrichten']['fertig'] is False
    assert t['kontenListe'][0]['handlung']['art'] == 'konto_anmelden'
    assert client.post('/api/handlung', json={'forge': FORGE, 'epic': 0, 'art': 'konto_anlegen'}, headers=PIN).status_code == 200
    t = client.get('/api/tafel').json()
    assert t['anlegen'][0]['forge'] == FORGE and t['anlegen'][0]['handlung']['art'] == 'konto_anlegen'


def test_tank_traegt_die_anmeldung(client, bericht):
    b = mit_konten(bericht, konto(1, 'nicht angemeldet'))
    b['konten'] = [{**b['konten'][0], 'konto': 'Konto 1'}]
    client.post('/api/bericht', json=b)
    t = client.get('/api/tafel').json()
    assert next(k for k in t['konten'] if k['konto'] == 'Konto 1')['anmeldung'] == 'nicht angemeldet'


def test_aelterer_treiber_ohne_kontenliste_gilt_als_eingerichtet(client, bericht):
    bericht = {k: v for k, v in bericht.items() if k != 'kontenListe'}
    client.post('/api/bericht', json=bericht)
    t = client.get('/api/tafel').json()
    assert t['einrichten']['fertig'] is True
    assert t['kontenListe'] == []


def test_huelle_startet_ohne_anker_im_maschinenraum_wenn_nicht_eingerichtet():
    from pathlib import Path
    js = (Path(__file__).parent.parent / 'app' / 'static' / 'huelle.js').read_text(encoding='utf-8')
    # #242: in the sub-tab Einrichtung, where the steps stand
    assert "if (stand === null && !location.hash && t.einrichten && !t.einrichten.fertig) gehe('maschinenraum/einrichtung');" in js
