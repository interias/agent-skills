from datetime import timedelta

FORGE = {'forge': 'interias/flotte-probe'}


def spalten(c):
    t = c.get('/api/tafel').json()
    return {s['id']: [k['nr'] for k in s['karten']] for s in t['spalten']}, t


def frage39(t):
    return next(s for s in t['spalten'] if s['id'] == 'frage')['karten'][0]['fragen'][0]


def antwort(c, text='A', pin='4711', **mehr):
    body = {'forge': 'interias/flotte-probe', 'epic': 39, 'nr': 1, 'seit': '2026-11-20T14:12:30Z', 'option': None, 'text': text, **mehr}
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
    assert k['titel'].startswith('Mini-Epic') and k['repo'] == 'flotte-probe' and k['konto'] == 'Konto 1'
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
    for f in bericht['fragen']:
        f['beantwortet'] = 'A'
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
    assert [(k['konto'], k['stufe']) for k in t['konten']] == [('Konto 1', 'gruen'), ('Konto 2', 'gelb')]
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
    assert antwort(client, 'config/ ist richtig', option='A').json()['ok']
    f = frage39(client.get('/api/tafel').json())
    assert f['antwort'] == {'option': 'A', 'text': 'config/ ist richtig', 'zeit': '2026-11-20T14:31:10+00:00', 'abgeholt': False, 'quittiert': False}
    assert f['empfohlen'] == ['A']

    geholt = abholen(client)
    assert len(geholt) == 1
    a = geholt[0]
    assert (a['epic'], a['nr'], a['option'], a['text'], a['herkunft']) == (39, 1, 'A', 'config/ ist richtig', 'Mensch über die Brücke')
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


# ---- free text always, the raw wording as fallback, the shared contract (#28, Zuverlässigkeit der Rückfragen)


def test_nur_option_nur_freitext_oder_beides(client, bericht):
    client.post('/api/bericht', json=bericht)
    antwort(client, None, option='B')
    assert [(a['option'], a['text']) for a in abholen(client)] == [('B', None)]
    client.post('/api/bericht', json={**bericht, 'fragen': [{**bericht['fragen'][1], 'seit': 'neu'}]})
    zwei = {'nr': 2, 'seit': 'neu'}
    assert antwort(client, '  protokoll  ', **zwei).status_code == 200
    assert [(a['nr'], a['option'], a['text']) for a in abholen(client)][-1] == (2, None, 'protokoll')


def test_freitext_auch_neben_optionen_unveraendert(client, bericht):
    client.post('/api/bericht', json=bericht)
    text = 'Weder A noch B — nimm „config.local.json“, siehe #12'
    antwort(client, text)
    assert abholen(client)[0]['text'] == text


def test_option_muss_zur_frage_passen(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert antwort(client, None, option='Z').status_code == 422
    assert antwort(client, None, option=None).status_code == 422
    assert antwort(client, '   ', option='').status_code == 422


def test_unzerlegter_block_zeigt_den_wortlaut(client, bericht):
    roh = 'FLOTTE-FRAGE 39 tor\nIch weiß nicht weiter: soll ich die Datei anlegen oder nicht?'
    bericht['fragen'] = [{'epic': 39, 'nr': 1, 'frage': '', 'roh': roh, 'seit': 'x', 'wartet': 'der ganze Lauf'}]
    client.post('/api/bericht', json=bericht)
    f = frage39(client.get('/api/tafel').json())
    assert f['roh'] == roh and f['frage'] == '' and f['optionen'] == []
    assert antwort(client, 'Anlegen', seit='x').status_code == 200


def test_vertrag_antworten(client, bericht):
    import json
    from pathlib import Path

    beispiel = json.loads((Path(__file__).parent.parent / 'beispiel' / 'antworten.json').read_text(encoding='utf-8'))
    client.post('/api/bericht', json=bericht)
    antwort(client, 'config/ ist richtig, aber ohne Unterordner', option='A')
    antwort(client, 'protokoll', nr=2)
    antwort(client, None, nr=3, option='A,C , I')
    geliefert = abholen(client)
    assert geliefert[2]['option'] == 'A, C, I'
    assert [sorted(a) for a in geliefert] == [sorted(a) for a in beispiel]
    for g, b in zip(geliefert, beispiel):
        assert {k: type(v) for k, v in g.items()} == {k: type(v) for k, v in b.items()}


def test_alte_datenbank_ohne_optionsspalte(tmp_path, uhr, bericht):
    import sqlite3

    from fastapi.testclient import TestClient

    from app.main import Einstellung, erzeuge

    db = tmp_path / 'alt.db'
    con = sqlite3.connect(db)
    con.executescript("""create table antworten (id integer primary key autoincrement, forge text not null, epic integer not null, nr integer not null,
      seit text not null, text text not null, zeit text not null, abgeholt text, quittiert text, unique (forge, epic, nr, seit));""")
    con.close()
    c = TestClient(erzeuge(Einstellung(db=str(db), pin='4711', uhr=uhr)))
    c.post('/api/bericht', json=bericht)
    assert antwort(c, 'x', option='A').status_code == 200
    assert abholen(c)[0]['option'] == 'A'


# ---- multiple choice


def test_mehrfachwahl_mit_neun_optionen(client, bericht):
    client.post('/api/bericht', json=bericht)
    t = client.get('/api/tafel').json()
    f = next(x for x in t['spalten'][2]['karten'][0]['fragen'] if x['nr'] == 3)
    assert f['mehrfach'] is True and [o['buchstabe'] for o in f['optionen']] == list('ABCDEFGHI')
    assert f['empfohlen'] == ['A', 'B']
    assert antwort(client, 'und Latein', nr=3, option='B, H, I').status_code == 200
    assert [(a['option'], a['text']) for a in abholen(client)] == [('B, H, I', 'und Latein')]


def test_einzelwahl_nimmt_nur_eine_option(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert antwort(client, None, option='A, B').status_code == 422
    assert antwort(client, None, nr=3, option='A, A').status_code == 422
    assert antwort(client, None, nr=3, option='A, J').status_code == 422
    assert antwort(client, None, option='C').status_code == 200


def test_empfehlung_bei_einzelwahl_nur_ein_buchstabe(client, bericht):
    bericht['fragen'][0]['empfehlung'] = 'A, B'
    client.post('/api/bericht', json=bericht)
    assert frage39(client.get('/api/tafel').json())['empfohlen'] == ['A']
