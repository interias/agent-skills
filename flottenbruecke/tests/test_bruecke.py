from datetime import timedelta

FORGE = {'forge': 'interias/flotte-probe'}


def spalten(c):
    t = c.get('/api/tafel').json()
    return {s['id']: [k['nr'] for k in s['karten']] for s in t['spalten']}, t


def frage39(t):
    return next(s for s in t['spalten'] if s['id'] == 'frage')['karten'][0]['fragen'][0]


def antwort(c, text='A', pin='4711', **mehr):
    body = {'forge': 'interias/flotte-probe', 'epic': 39, 'nr': 1, 'seit': '2026-11-20T14:12:30Z', 'text': text, **mehr}
    return c.post('/api/antwort', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def abholen(c):
    return c.get('/api/antworten', params=FORGE).json()


# ---- report and board


def test_erster_bericht_legt_projekt_an(client, bericht):
    assert client.get('/api/tafel').json()['projekte'] == []
    assert client.post('/api/bericht', json=bericht).json() == {'ok': True, 'neu': True}
    assert client.post('/api/bericht', json=bericht).json() == {'ok': True, 'neu': False}
    projekte = client.get('/api/tafel').json()['projekte']
    assert [p['forge'] for p in projekte] == ['interias/flotte-probe']
    assert projekte[0]['aktiv'] and not projekte[0]['veraltet']


def test_epics_in_den_richtigen_spalten(client, bericht):
    client.post('/api/bericht', json=bericht)
    s, _ = spalten(client)
    assert s == {'bereit': [41], 'laeuft': [38], 'frage': [39], 'schlange': [36, 37], 'gemergt': [35], 'blockiert': [40]}


def test_schlange_in_der_reihenfolge_des_treibers(client, bericht):
    bericht['schlange'] = [37, 36]
    client.post('/api/bericht', json=bericht)
    s, t = spalten(client)
    assert s['schlange'] == [37, 36]
    assert [k['position'] for k in t['spalten'][3]['karten']] == [1, 2]


def test_karte_traegt_was_das_board_zeigt(client, bericht):
    client.post('/api/bericht', json=bericht)
    _, t = spalten(client)
    k = t['spalten'][1]['karten'][0]
    assert k['titel'].startswith('Mini-Epic') and k['repo'] == 'flotte-probe' and k['konto'] == '.claude'
    assert [p['stand'] for p in k['pakete']] == ['fertig', 'laeuft', 'offen']
    assert k['schritt'] and k['schrittZeit']
    assert k['issueUrl'] == 'https://github.com/interias/flotte-probe/issues/38'


def test_offene_frage_zieht_laufendes_epic_in_frage_an_dich(client, bericht):
    # parked packages: the run goes on, the question still waits for the person
    bericht['fragen'][0]['epic'] = 38
    bericht['fragen'][0]['ganzerLauf'] = False
    client.post('/api/bericht', json=bericht)
    s, _ = spalten(client)
    assert 38 in s['frage'] and 38 not in s['laeuft']


def test_beantwortete_frage_verschwindet(client, bericht):
    bericht['fragen'][0]['beantwortet'] = 'A'
    bericht['epics'][2]['stufe'] = 'laeuft'
    client.post('/api/bericht', json=bericht)
    s, _ = spalten(client)
    assert s['frage'] == [] and 39 in s['laeuft']


def test_gemergt_nur_heute(client, bericht, uhr):
    del bericht['epics'][5]['gemergtAm']
    bericht['epics'][5]['stufe'] = 'gemergt'
    client.post('/api/bericht', json=bericht)
    assert spalten(client)[0]['gemergt'] == [35]
    uhr.t += timedelta(days=1)
    client.post('/api/bericht', json=bericht)
    assert spalten(client)[0]['gemergt'] == []


def test_gemergt_am_aus_dem_bericht_zaehlt(client, bericht):
    bericht['epics'][5]['gemergtAm'] = '2026-11-19T20:00:00Z'
    client.post('/api/bericht', json=bericht)
    assert spalten(client)[0]['gemergt'] == []


def test_kopf_bremsen_als_stufe_ram_und_platte(client, bericht):
    client.post('/api/bericht', json=bericht)
    t = client.get('/api/tafel').json()
    assert [(k['konto'], k['stufe']) for k in t['konten']] == [('.claude', 'gruen'), ('.claude-arbeitspferd', 'gelb')]
    assert t['rechner'][0]['ram']['stufe'] == 'ok' and t['rechner'][0]['platte']['freiGb'] == 212.5


def test_bremse_in_prozent_wird_abgelehnt(client, bericht):
    bericht['konten'][0]['stufe'] = '80 %'
    assert client.post('/api/bericht', json=bericht).status_code == 422


def test_stiller_treiber_gilt_als_veraltet(client, bericht, uhr):
    client.post('/api/bericht', json=bericht)
    uhr.t += timedelta(minutes=4)
    p = client.get('/api/tafel').json()['projekte'][0]
    assert p['veraltet'] and not p['aktiv']


def test_zwei_projekte_nebeneinander(client, bericht):
    client.post('/api/bericht', json=bericht)
    zweiter = {**bericht, 'forge': 'interias/agent-skills', 'url': None, 'fragen': [], 'epics': [{'nr': 28, 'titel': 'Flottenbrücke', 'stufe': 'laeuft'}]}
    client.post('/api/bericht', json=zweiter)
    s, t = spalten(client)
    assert s['laeuft'] == [28, 38]
    assert len(t['projekte']) == 2


def test_ungueltiger_forge_name(client, bericht):
    bericht['forge'] = '../etc'
    assert client.post('/api/bericht', json=bericht).status_code == 422


# ---- answers and PIN


def test_ansehen_ohne_pin_antworten_nicht(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert client.get('/api/tafel').status_code == 200
    assert client.get('/').status_code == 200
    assert antwort(client, pin=None).status_code == 401
    assert antwort(client, pin='0000').status_code == 401
    assert abholen(client) == []


def test_ohne_gesetzte_pin_ist_antworten_aus(bruecke, bericht):
    c = bruecke(pin='')
    c.post('/api/bericht', json=bericht)
    assert c.get('/api/tafel').json()['pin'] is False
    assert antwort(c, pin='').status_code == 403
    assert c.post('/api/pin', headers={'X-Bruecke-Pin': ''}).status_code == 403


def test_pin_pruefen(client):
    assert client.post('/api/pin', headers={'X-Bruecke-Pin': '4711'}).status_code == 204
    assert client.post('/api/pin', headers={'X-Bruecke-Pin': '1234'}).status_code == 401


def test_pin_sperre_nach_fuenf_fehlern(client):
    for _ in range(5):
        assert client.post('/api/pin', headers={'X-Bruecke-Pin': 'falsch'}).status_code == 401
    assert client.post('/api/pin', headers={'X-Bruecke-Pin': '4711'}).status_code == 429


def test_antwort_abholen_quittieren(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert antwort(client, 'A — config/ ist richtig').json()['ok']
    f = frage39(client.get('/api/tafel').json())
    assert f['antwort'] == {'text': 'A — config/ ist richtig', 'zeit': '2026-11-20T14:31:10+00:00', 'abgeholt': False, 'quittiert': False}
    assert f['empfohlen'] == 'A'

    geholt = abholen(client)
    assert len(geholt) == 1
    a = geholt[0]
    assert (a['epic'], a['nr'], a['text'], a['herkunft']) == (39, 1, 'A — config/ ist richtig', 'Mensch über die Brücke')
    # fetched, not yet acknowledged: the driver gets it again in the next turn
    assert len(abholen(client)) == 1
    assert antwort(client, 'B').status_code == 409

    assert client.post(f"/api/antworten/{a['id']}/quittung").json() == {'ok': True}
    assert abholen(client) == []
    assert frage39(client.get('/api/tafel').json())['antwort']['quittiert'] is True
    assert client.post('/api/antworten/999/quittung').status_code == 404


def test_antwort_aendern_bis_zum_abholen(client, bericht):
    client.post('/api/bericht', json=bericht)
    antwort(client, 'A')
    antwort(client, 'B')
    assert [a['text'] for a in abholen(client)] == ['B']


def test_antwort_nur_auf_offene_frage(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert antwort(client, seit='2026-11-19T10:00:00Z').status_code == 404
    bericht['fragen'][0]['beantwortet'] = 'C'
    client.post('/api/bericht', json=bericht)
    assert antwort(client).status_code == 409


def test_neue_frage_mit_derselben_nummer_ist_eine_andere(client, bericht):
    client.post('/api/bericht', json=bericht)
    a = antwort(client, 'A').json()['id']
    abholen(client)
    client.post(f'/api/antworten/{a}/quittung')
    bericht['fragen'][0]['seit'] = '2026-11-20T15:00:00Z'
    client.post('/api/bericht', json=bericht)
    assert antwort(client, 'B', seit='2026-11-20T15:00:00Z').status_code == 200


def test_leere_antwort_abgelehnt(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert antwort(client, '').status_code == 422


# ---- optional driver token


def test_treiber_token(bruecke, bericht):
    c = bruecke(token='geheim')
    assert c.post('/api/bericht', json=bericht).status_code == 401
    assert c.post('/api/bericht', json=bericht, headers={'X-Bruecke-Token': 'geheim'}).status_code == 200
    assert c.get('/api/antworten', params=FORGE).status_code == 401
    assert c.post('/api/antworten/1/quittung').status_code == 401
    # viewing stays free
    assert c.get('/api/tafel').status_code == 200


def test_daten_ueberleben_neustart(bruecke, bericht):
    bruecke().post('/api/bericht', json=bericht)
    assert len(bruecke().get('/api/tafel').json()['projekte']) == 1
