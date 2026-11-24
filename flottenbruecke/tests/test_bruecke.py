import json
import re
from datetime import timedelta
from pathlib import Path

from conftest import koppeln

FORGE = {'forge': 'interias/flotte-probe'}
SEIT = '2026-11-20T13:52:30Z'
BEISPIEL = Path(__file__).parent.parent / 'beispiel'

# two more questions of epic 39 beside the example's one: free text only, and a multiple choice
FRAGE2 = {'epic': 39, 'nr': 2, 'frage': 'Wie soll der Schlüssel für das Protokoll heißen?', 'lage': 'Das Epic nennt keinen.', 'optionen': [], 'betrifft': 'P2', 'wartet': 'P2', 'ganzerLauf': False, 'seit': SEIT, 'roh': '2. Wie soll der Schlüssel …'}
FRAGE3 = {'epic': 39, 'nr': 3, 'frage': 'In welchen Sprachen erscheint der Gruß?', 'optionen': [{'buchstabe': b, 'text': t} for b, t in zip('ABCDEFGHI', ['Deutsch', 'Englisch', 'Französisch', 'Spanisch', 'Italienisch', 'Niederländisch', 'Polnisch', 'Tschechisch', 'Dänisch'])], 'mehrfach': True, 'empfehlung': 'A, B', 'ganzerLauf': False, 'seit': SEIT}
WIDERRUF = {'epic': 38, 'nr': 1, 'seit': '2026-11-20T14:18:02Z', 'text': 'Unter der nächsten Version, nicht unter Unreleased'}


def tafel(c):
    return c.get('/api/tafel').json()


def ebenen(c):
    t = tafel(c)
    u = t['unterwegs']
    return {
        'braucht': [(x['art'], x['epic']) for x in t['braucht']],
        'laeufe': [x['nr'] for x in u['laeufe']],
        'schlange': [x['nr'] for x in u['schlange']],
        'bereit': [x['nr'] for x in u['bereit']],
        'erledigt': [(x['art'], x['epic']) for x in t['erledigt']],
    }


def frage39(t, nr=1):
    return next(x for x in t['braucht'] if x['art'] == 'frage' and x['epic'] == 39 and x['nr'] == nr)


def antwort(c, text='A', pin='4711', **mehr):
    body = {'forge': 'interias/flotte-probe', 'epic': 39, 'nr': 1, 'seit': SEIT, 'option': None, 'text': text, **mehr}
    return c.post('/api/antwort', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def handlung(c, art='einreihen', pin='4711', **mehr):
    body = {'forge': 'interias/flotte-probe', 'epic': 40, 'art': art, **mehr}
    return c.post('/api/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def abholen(c, was='antworten'):
    return c.get(f'/api/{was}', params=FORGE).json()


def mit_fragen(bericht):
    bericht['fragen'] = [bericht['fragen'][0], FRAGE2, FRAGE3]
    return bericht


# ---- report and board: three levels


def test_erster_bericht_legt_projekt_an(client, bericht):
    assert tafel(client)['projekte'] == []
    assert client.post('/api/bericht', json=bericht).json() == {'ok': True, 'neu': True}
    assert client.post('/api/bericht', json=bericht).json() == {'ok': True, 'neu': False}
    projekte = tafel(client)['projekte']
    assert [p['forge'] for p in projekte] == ['interias/flotte-probe']
    assert projekte[0]['aktiv'] and not projekte[0]['veraltet']
    assert (projekte[0]['taktS'], projekte[0]['leerlaufS']) == (60, 3600)


def test_drei_ebenen(client, bericht):
    client.post('/api/bericht', json=bericht)
    e = ebenen(client)
    # the blockade holds a whole epic: before the question that parks one package, though that waits longer
    assert e['braucht'] == [('blockade', 40), ('frage', 39)]
    assert (e['laeufe'], e['schlange'], e['bereit']) == ([38, 39], [36, 37], [41, 42])
    assert e['erledigt'] == [('admiral', 38), ('admiral', 39), ('gemergt', 35)]


def test_kosten_des_wartens(client, bericht):
    # what holds a whole epic first, then the longest wait
    zwei = {**FRAGE2, 'epic': 38, 'seit': '2026-11-20T14:20:00Z', 'ganzerLauf': True, 'betrifft': 'Lauf', 'wartet': 'der ganze Lauf'}
    drei = {**FRAGE3, 'epic': 38, 'seit': '2026-11-20T13:00:00Z'}
    bericht['fragen'] += [zwei, drei]
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    assert [(x['art'], x['epic'], x.get('nr')) for x in t['braucht']] == [('blockade', 40, 40), ('frage', 38, 2), ('frage', 38, 3), ('frage', 39, 1)]
    assert [x['wartetS'] for x in t['braucht']] == [1526, 670, 5470, 2320]


def test_fragekarte_traegt_was_der_mensch_braucht(client, bericht):
    client.post('/api/bericht', json=bericht)
    f = frage39(tafel(client))
    assert f['frage'].startswith('Wo liegt') and f['titel'].startswith('Mini-Epic') and f['konto'] == 'Konto 2'
    assert (f['marke'], f['umkehrbar'], f['herkunft']) == ('nach außen sichtbar', False, 'Eigenes Urteil: nach außen sichtbar')
    assert f['grund'].startswith('Der Ort der Datei')
    # holds 1 of 3 packages
    assert (f['geparkt'], f['paketeGesamt'], f['ganzerLauf']) == (['P2'], 3, False)
    assert f['empfohlen'] == ['A'] and f['optionen'][0]['text'].endswith(', folgt dem vorhandenen Muster')
    assert f['issueUrl'] == 'https://github.com/interias/flotte-probe/issues/39' and f['aktiv'] is True
    assert f['wartetS'] == 2320


def test_blockadekarte_mit_grund_und_log(client, bericht):
    client.post('/api/bericht', json=bericht)
    b = tafel(client)['braucht'][0]
    assert (b['art'], b['epic'], b['stufe']) == ('blockade', 40, 'blockiert')
    assert b['grund'].startswith('3 Gate-Läufe') and len(b['log']) == 5
    assert (b['seit'], b['wartetS'], b['handlung']) == ('2026-11-20T14:05:44+00:00', 1526, None)


def test_lauf_mit_lebenszeichen(client, bericht):
    client.post('/api/bericht', json=bericht)
    l38 = tafel(client)['unterwegs']['laeufe'][0]
    assert (l38['prozess'], l38['leerlaufS'], l38['schrittZeit']) == (True, 3600, '2026-11-20T14:29:40Z')
    assert [p['stand'] for p in l38['pakete']] == ['fertig', 'laeuft', 'offen', 'laeuft', 'laeuft', 'laeuft']


def test_pakete_als_links_auf_die_tickets(client, bericht):
    client.post('/api/bericht', json=bericht)
    laeufe = tafel(client)['unterwegs']['laeufe']
    p38 = laeufe[0]['pakete'][0]
    assert (p38['nr'], p38['titel'], p38['url']) == (46, 'Zählerdatei anlegen', 'https://github.com/interias/flotte-probe/issues/46')
    # spec mode: packages are no issues, a name without link
    assert [(p['name'], p['url']) for p in laeufe[1]['pakete']] == [('P1', None), ('P2', None), ('P3', None)]
    bericht['epics'][1]['pakete'][0]['stand'] = 'review'
    assert client.post('/api/bericht', json=bericht).status_code == 422


def test_epic_das_ganz_auf_den_menschen_wartet_steht_unterwegs_hinten(client, bericht):
    bericht['epics'][1]['stufe'] = 'frage'
    client.post('/api/bericht', json=bericht)
    laeufe = tafel(client)['unterwegs']['laeufe']
    assert [(x['nr'], x['wartetAufDich']) for x in laeufe] == [(39, False), (38, True)]


def test_beantwortete_frage_verschwindet(client, bericht):
    bericht['fragen'][0]['beantwortet'] = 'A'
    client.post('/api/bericht', json=bericht)
    assert ebenen(client)['braucht'] == [('blockade', 40)]


def test_gemergt_nur_heute(client, bericht, uhr):
    del bericht['epics'][5]['gemergtAm']
    bericht['epics'][5]['stufe'] = 'gemergt'
    client.post('/api/bericht', json=bericht)
    assert ('gemergt', 35) in ebenen(client)['erledigt']
    uhr.t += timedelta(days=1)
    client.post('/api/bericht', json=bericht)
    assert ebenen(client)['erledigt'] == []


def test_gemergt_am_aus_dem_bericht_zaehlt(client, bericht):
    bericht['epics'][5]['gemergtAm'] = '2026-11-19T20:00:00Z'
    client.post('/api/bericht', json=bericht)
    assert ('gemergt', 35) not in ebenen(client)['erledigt']


def test_aufgegeben_wandert_nach_erledigt(client, bericht):
    bericht['epics'][6]['stufe'] = 'abgebrochen'
    bericht['epics'][6]['aufgegebenAm'] = '2026-11-20T14:30:00Z'
    client.post('/api/bericht', json=bericht)
    e = ebenen(client)
    assert e['braucht'] == [('frage', 39)] and e['erledigt'][0] == ('aufgegeben', 40)


def test_admiral_entscheidung_mit_widerruf(client, bericht):
    client.post('/api/bericht', json=bericht)
    d = next(x for x in tafel(client)['erledigt'] if x['art'] == 'admiral' and x['epic'] == 38)
    assert (d['nr'], d['antwort'], d['herkunft'], d['einflussreich'], d['widerrufbar']) == (1, 'B', 'Skill-Empfehlung', True, True)
    assert d['seit'] == '2026-11-20T14:18:02Z'


def test_kopf_konten_mit_verbrauch_ram_und_platte(client, bericht):
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    assert [(k['konto'], k['stufe'], k['fuenf']['verbraucht'], k['woche']['verbraucht']) for k in t['konten']] == [('Konto 1', 'gruen', 38.5, 52.0), ('Konto 2', 'gelb', 71.0, 64.5)]
    assert t['konten'][0]['fuenf']['reset'] == '2026-11-20T17:40:00Z'
    assert t['rechner'][0]['ram']['stufe'] == 'ok' and t['rechner'][0]['platte']['freiGb'] == 212.5


def test_bericht_eines_alten_treibers_ohne_neue_felder(client, bericht):
    for k in ('leerlaufS', 'ereignisse', 'entscheidungen'):
        del bericht[k]
    for k in bericht['konten']:
        del k['fuenf'], k['woche'], k['alterMin']
    for ep in bericht['epics']:
        for k in ('prozess', 'grund', 'haltZeit', 'log', 'aufgegebenAm', 'prio'):
            del ep[k]
    for k in ('herkunft', 'marke', 'umkehrbar', 'geparkt'):
        del bericht['fragen'][0][k]
    assert client.post('/api/bericht', json=bericht).status_code == 200
    assert ebenen(client)['braucht'] == [('blockade', 40), ('frage', 39)]
    assert tafel(client)['braucht'][0]['grund'].startswith('Gate dreimal rot')


def test_stufe_statt_prozent_bleibt_pflicht(client, bericht):
    bericht['konten'][0]['stufe'] = '80 %'
    assert client.post('/api/bericht', json=bericht).status_code == 422


def test_laufband_ueber_alle_projekte(client, bericht):
    client.post('/api/bericht', json=bericht)
    zweiter = {**bericht, 'forge': 'interias/agent-skills', 'url': None, 'fragen': [], 'entscheidungen': [], 'epics': [{'nr': 28, 'titel': 'Flottenbrücke', 'stufe': 'laeuft'}], 'ereignisse': [{'zeit': '2026-11-20T14:30:00Z', 'epic': 28, 'text': 'Lauf gestartet'}]}
    client.post('/api/bericht', json=zweiter)
    t = tafel(client)
    assert [(e['kurz'], e['epic']) for e in t['ereignisse'][:2]] == [('agent-skills', 28), ('flotte-probe', None)]
    assert [x['nr'] for x in t['unterwegs']['laeufe']] == [28, 38, 39]
    assert len(t['projekte']) == 2


def test_stiller_treiber_gilt_als_veraltet(client, bericht, uhr):
    client.post('/api/bericht', json=bericht)
    uhr.t += timedelta(minutes=4)
    t = tafel(client)
    assert t['projekte'][0]['veraltet'] and not t['projekte'][0]['aktiv']
    assert t['braucht'][0]['aktiv'] is False


def test_ohne_treiber_verspricht_keine_karte_den_naechsten_takt():
    # #135: a requeue waiting while no driver reports is not fetched "in the next tick"
    static = Path(__file__).parent.parent / 'app' / 'static'
    for datei in ['app.js', 'bereiche/sternenkarte.js', 'bereiche/frachtraum.js']:
        js = (static / datei).read_text(encoding='utf-8')
        assert 'kein Treiber läuft' in js, datei
        for zeile in js.splitlines():
            if 'nächsten Takt ab' in zeile:
                assert 'kein Treiber läuft' in zeile, f'{datei}: {zeile.strip()[:80]}'


def test_ungueltiger_forge_name(client, bericht):
    bericht['forge'] = '../etc'
    assert client.post('/api/bericht', json=bericht).status_code == 422


# ---- answers and PIN


def test_ansehen_ohne_pin_antworten_nicht(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert client.get('/api/tafel').status_code == 200
    assert client.get('/').status_code == 200
    assert antwort(client, pin=None).status_code == 403
    assert antwort(client, pin='0000').status_code == 403
    assert abholen(client) == []


def test_ohne_gesetzte_pin_ist_antworten_aus(bruecke, bericht):
    c = bruecke(pin='')
    c.post('/api/bericht', json=bericht)
    assert tafel(c)['pin'] is False
    assert antwort(c, pin='').status_code == 403
    assert handlung(c, pin='').status_code == 403
    assert c.post('/api/pin', headers={'X-Bruecke-Pin': ''}).status_code == 403


def test_pin_pruefen(client):
    assert client.post('/api/pin', headers={'X-Bruecke-Pin': '4711'}).status_code == 204
    assert client.post('/api/pin', headers={'X-Bruecke-Pin': '1234'}).status_code == 403


def test_pin_sperre_nach_fuenf_fehlern(client):
    for _ in range(5):
        assert client.post('/api/pin', headers={'X-Bruecke-Pin': 'falsch'}).status_code == 403
    assert client.post('/api/pin', headers={'X-Bruecke-Pin': '4711'}).status_code == 429


def test_antwort_abholen_quittieren(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert antwort(client, 'config/ ist richtig', option='A').json()['ok']
    f = frage39(tafel(client))
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
    assert frage39(tafel(client))['antwort']['quittiert'] is True
    assert client.post('/api/antworten/999/quittung').status_code == 404
    # acknowledged and gone from the report: the person's answer stands in level 3
    bericht['fragen'] = []
    client.post('/api/bericht', json=bericht)
    du = [x for x in tafel(client)['erledigt'] if x['art'] == 'antwort']
    assert [(x['epic'], x['nr'], x['option'], x['text']) for x in du] == [(39, 1, 'A', 'config/ ist richtig')]


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
    assert c.get('/api/handlungen', params=FORGE).status_code == 401
    assert c.post('/api/handlungen/1/quittung').status_code == 401
    # viewing stays free
    assert c.get('/api/tafel').status_code == 200


def test_daten_ueberleben_neustart(bruecke, bericht):
    bruecke().post('/api/bericht', json=bericht)
    assert len(tafel(bruecke())['projekte']) == 1


# ---- free text always, the raw wording as fallback, the shared contract (#28, Zuverlässigkeit der Rückfragen)


def test_nur_option_nur_freitext_oder_beides(client, bericht):
    client.post('/api/bericht', json=bericht)
    antwort(client, None, option='B')
    assert [(a['option'], a['text']) for a in abholen(client)] == [('B', None)]
    client.post('/api/bericht', json={**bericht, 'fragen': [{**FRAGE2, 'seit': 'neu'}]})
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
    f = frage39(tafel(client))
    assert f['roh'] == roh and f['frage'] == '' and f['optionen'] == []
    assert antwort(client, 'Anlegen', seit='x').status_code == 200


def test_vertrag_antworten(client, bericht):
    beispiel = json.loads((BEISPIEL / 'antworten.json').read_text(encoding='utf-8'))
    client.post('/api/bericht', json=mit_fragen(bericht))
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
    koppeln(c)
    c.post('/api/bericht', json=bericht)
    assert antwort(c, 'x', option='A').status_code == 200
    assert abholen(c)[0]['option'] == 'A'
    assert handlung(c).status_code == 200


# ---- multiple choice


def test_mehrfachwahl_mit_neun_optionen(client, bericht):
    client.post('/api/bericht', json=mit_fragen(bericht))
    f = frage39(tafel(client), 3)
    assert f['mehrfach'] is True and [o['buchstabe'] for o in f['optionen']] == list('ABCDEFGHI')
    assert f['empfohlen'] == ['A', 'B']
    assert antwort(client, 'und Latein', nr=3, option='B, H, I').status_code == 200
    assert [(a['option'], a['text']) for a in abholen(client)] == [('B, H, I', 'und Latein')]


def test_einzelwahl_nimmt_nur_eine_option(client, bericht):
    client.post('/api/bericht', json=mit_fragen(bericht))
    assert antwort(client, None, option='A, B').status_code == 422
    assert antwort(client, None, nr=3, option='A, A').status_code == 422
    assert antwort(client, None, nr=3, option='A, J').status_code == 422
    assert antwort(client, None, option='C').status_code == 200


def test_empfehlung_bei_einzelwahl_nur_ein_buchstabe(client, bericht):
    bericht['fragen'][0]['empfehlung'] = 'A, B'
    client.post('/api/bericht', json=bericht)
    assert frage39(tafel(client))['empfohlen'] == ['A']


def test_icons_und_manifest(client):
    seite = client.get('/').text
    for pfad in ['/static/icon.svg', '/static/icon-32.png', '/static/apple-touch-icon.png', '/static/manifest.webmanifest']:
        assert pfad in seite and client.get(pfad).status_code == 200
    m = client.get('/static/manifest.webmanifest').json()
    assert {i['src'] for i in m['icons']} >= {'/static/icon-192.png', '/static/icon-512.png'}
    assert all(client.get(i['src']).status_code == 200 for i in m['icons'])
    assert client.get('/favicon.ico').headers['content-type'] == 'image/png'


# ---- actions: requeue, give up, revoke (#28, v2)


def test_handlung_braucht_pin(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert handlung(client, pin=None).status_code == 403
    assert handlung(client, pin='0000').status_code == 403
    assert abholen(client, 'handlungen') == []


def test_einreihen_abholen_quittieren(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert handlung(client).json()['ok']
    assert tafel(client)['braucht'][0]['handlung']['art'] == 'einreihen'
    # changed its mind before the driver fetched it: the last one counts
    assert handlung(client, 'aufgeben').status_code == 200
    geholt = abholen(client, 'handlungen')
    assert [(h['epic'], h['art'], h['herkunft']) for h in geholt] == [(40, 'aufgeben', 'Mensch über die Brücke')]
    assert handlung(client).status_code == 409
    assert client.post(f"/api/handlungen/{geholt[0]['id']}/quittung").json() == {'ok': True}
    assert abholen(client, 'handlungen') == []
    assert client.post('/api/handlungen/999/quittung').status_code == 404


def test_handlung_nur_fuer_blockierte_epics(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert handlung(client, epic=38).status_code == 409
    assert handlung(client, epic=99).status_code == 404
    bericht['epics'][6]['aufgegebenAm'] = '2026-11-20T14:30:00Z'
    client.post('/api/bericht', json=bericht)
    assert handlung(client).status_code == 409


def test_widerruf_einer_admiral_entscheidung(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert handlung(client, 'widerruf', **{**WIDERRUF, 'text': ' '}).status_code == 422
    assert handlung(client, 'widerruf', **{**WIDERRUF, 'seit': '2026-11-20T09:00:00Z'}).status_code == 404
    assert handlung(client, 'widerruf', **WIDERRUF).status_code == 200
    d = next(x for x in tafel(client)['erledigt'] if x['art'] == 'admiral' and x['epic'] == 38)
    assert d['handlung']['text'] == WIDERRUF['text']
    assert [(h['art'], h['nr'], h['seit'], h['text']) for h in abholen(client, 'handlungen')] == [('widerruf', 1, WIDERRUF['seit'], WIDERRUF['text'])]


def test_kein_widerruf_nach_dem_merge(client, bericht):
    bericht['epics'][1]['stufe'] = 'fertig'
    client.post('/api/bericht', json=bericht)
    d = next(x for x in tafel(client)['erledigt'] if x['art'] == 'admiral' and x['epic'] == 38)
    assert d['widerrufbar'] is False
    assert handlung(client, 'widerruf', **WIDERRUF).status_code == 409


def test_vertrag_handlungen(client, bericht):
    beispiel = json.loads((BEISPIEL / 'handlungen.json').read_text(encoding='utf-8'))
    client.post('/api/bericht', json=bericht)
    handlung(client)
    handlung(client, 'widerruf', **WIDERRUF)
    handlung(client, 'einstellen', epic=0, text='{"name": "obergrenze", "wert": 2}')
    for epic, art, text in [(43, 'aufnehmen', None), (38, 'pausieren', None), (39, 'fortsetzen', None), (41, 'prioritaet', 'hoch'), (38, 'merge', 'mensch')]:
        assert handlung(client, art, epic=epic, text=text).status_code == 200
    # #116: the Frachtraum
    assert handlung(client, 'triage', epic=0).status_code == 200
    assert handlung(client, 'triage-antwort', epic=61, nr=1, seit='2026-11-20T13:05:00Z', text='{"option": "B", "text": null}').status_code == 200
    assert handlung(client, 'triage-widerruf', epic=58, seit='2026-11-20T13:04:30Z', text='Die alte Ansicht brauchen wir noch für den Beamer im Besprechungsraum.').status_code == 200
    # #148: a mission of the cut plan
    assert handlung(client, 'schnitt-widerruf', epic=70, text='Suche und Filter sind zwei Dinge; erst den Filter allein.').status_code == 200
    # #154: the update of the driver
    assert handlung(client, 'einspielen', epic=0).status_code == 200
    geliefert = abholen(client, 'handlungen')
    assert [sorted(h) for h in geliefert] == [sorted(h) for h in beispiel]
    for g, b in zip(geliefert, beispiel):
        assert {k: type(v) for k, v in g.items()} == {k: type(v) for k, v in b.items()}
        assert (g['art'], g['nr'], g['seit'], g['text']) == (b['art'], b['nr'], b['seit'], b['text'])


# ---- prio/hoch and the update in running operation (#28, Nachtrag)


def test_prio_steht_in_bereit_oben_mit_grund(client, bericht):
    bericht['epics'].append({'nr': 30, 'titel': 'Frühes Epic', 'stufe': 'wartend', 'notiz': ''})
    client.post('/api/bericht', json=bericht)
    bereit = tafel(client)['unterwegs']['bereit']
    assert [(x['nr'], x['prio']) for x in bereit] == [(41, True), (30, False), (42, False)]
    assert bereit[0]['notiz'] == 'wartet auf den Merge von #38'


def test_bereit_zeigt_die_kind_tickets_als_links(client, bericht):
    client.post('/api/bericht', json=bericht)
    b41, b42 = tafel(client)['unterwegs']['bereit']
    assert (b41['id'], b41['issueUrl']) == ('epic:interias/flotte-probe#41', 'https://github.com/interias/flotte-probe/issues/41')
    assert [(p['nr'], p['stand'], p['url']) for p in b41['pakete']] == [
        (50, 'fertig', 'https://github.com/interias/flotte-probe/issues/50'),
        (51, 'offen', 'https://github.com/interias/flotte-probe/issues/51'),
        (52, 'offen', 'https://github.com/interias/flotte-probe/issues/52'),
    ]
    # spec mode: no child tickets, an empty list
    assert b42['pakete'] == []
    # an older driver without pakete
    del bericht['epics'][0]['pakete']
    client.post('/api/bericht', json=bericht)
    assert tafel(client)['unterwegs']['bereit'][0]['pakete'] == []


def test_v2_startet_auf_dem_volume_von_v1(tmp_path, uhr, bericht):
    """The database of the first bridge: no table handlungen, an open answer, an old report."""
    import sqlite3

    from fastapi.testclient import TestClient

    from app.main import Einstellung, erzeuge

    alt = {k: v for k, v in bericht.items() if k not in ('leerlaufS', 'ereignisse', 'entscheidungen')}
    alt['konten'] = [{'konto': k['konto'], 'stufe': k['stufe']} for k in alt['konten']]
    alt['epics'] = [{k: v for k, v in ep.items() if k not in ('prozess', 'grund', 'haltZeit', 'log', 'aufgegebenAm', 'prio')} for ep in alt['epics']]
    alt['fragen'] = [{k: v for k, v in f.items() if k not in ('herkunft', 'marke', 'umkehrbar', 'geparkt')} for f in alt['fragen']]
    db = tmp_path / 'v1.db'
    con = sqlite3.connect(db)
    con.executescript("""
create table projekte (forge text primary key, angelegt text not null, empfangen text not null, bericht text not null);
create table stufen (forge text not null, nr integer not null, stufe text not null, seit text not null, primary key (forge, nr));
create table antworten (id integer primary key autoincrement, forge text not null, epic integer not null, nr integer not null,
  seit text not null, option text, text text not null, zeit text not null, abgeholt text, quittiert text, unique (forge, epic, nr, seit));""")
    con.execute('insert into projekte values (?, ?, ?, ?)', ('interias/flotte-probe', '2026-11-20T14:00:00+00:00', '2026-11-20T14:31:00+00:00', json.dumps(alt)))
    con.execute("insert into antworten (forge, epic, nr, seit, option, text, zeit) values ('interias/flotte-probe', 39, 1, ?, 'A', '', '2026-11-20T14:30:00+00:00')", (SEIT,))
    con.commit()
    con.close()
    c = TestClient(erzeuge(Einstellung(db=str(db), pin='4711', uhr=uhr)))
    koppeln(c)
    t = tafel(c)
    assert [(x['art'], x['epic']) for x in t['braucht']] == [('blockade', 40), ('frage', 39)]
    assert frage39(t)['antwort']['option'] == 'A' and frage39(t)['marke'] == ''
    assert t['konten'][0]['fuenf'] is None and t['ereignisse'] == []
    # the open answer survived; actions work on the old volume
    assert [(a['epic'], a['option']) for a in abholen(c)] == [(39, 'A')]
    assert handlung(c).status_code == 200


def test_zeiten_in_unterwegs(client, bericht):
    client.post('/api/bericht', json=bericht)
    u = tafel(client)['unterwegs']
    l38 = next(l for l in u['laeufe'] if l['nr'] == 38)
    assert l38['gestartetAm'] == '2026-11-20T12:06:40Z'
    assert (l38['pakete'][0]['beginn'], l38['pakete'][0]['ende']) == ('2026-11-20T12:20:00Z', '2026-11-20T13:02:30Z')
    s36 = next(s for s in u['schlange'] if s['nr'] == 36)
    assert s36['seit'].startswith('2026-11-20T14:05:20') and s36['gateSeit'] == '2026-11-20T14:27:45Z'
    # an older driver without the times: the stage change seen by the bridge stays the queue time
    for e in bericht['epics']:
        for k in ('gestartetAm', 'schlangeSeit', 'gateSeit'):
            e.pop(k)
    client.post('/api/bericht', json=bericht)
    s36 = next(s for s in tafel(client)['unterwegs']['schlange'] if s['nr'] == 36)
    assert s36['seit'] and s36['gateSeit'] is None


def test_prognose_in_bereit_und_fuer_den_backlog(client, bericht):
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    b41 = t['unterwegs']['bereit'][0]
    assert b41['nr'] == 41 and b41['prognose'] == {'p50': 10800, 'p90': 18000}
    assert t['projekte'][0]['prognose'] == {'status': 'ok', 'ab': 5, 'bisher': 12, 'treffer': 7, 'geprueft': 10, 'backlog': {'p50': 19800, 'p90': 34200}, 'berechnet': '2026-11-20T14:31:05Z'}
    # an older driver without it, and below the threshold
    del bericht['prognose']
    client.post('/api/bericht', json=bericht)
    assert tafel(client)['projekte'][0]['prognose'] is None
    bericht['prognose'] = {'status': 'zu_wenig', 'ab': 5, 'bisher': 2, 'backlog': None, 'berechnet': '2026-11-20T14:31:05Z'}
    for e in bericht['epics']:
        e['prognose'] = None
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    assert t['projekte'][0]['prognose']['status'] == 'zu_wenig' and t['unterwegs']['bereit'][0]['prognose'] is None
    bericht['prognose']['status'] = 'vielleicht'
    assert client.post('/api/bericht', json=bericht).status_code == 422


def test_seite_bindet_skript_und_stil_mit_inhaltsstand_ein(client):
    # an updated bridge must not run old cached app.js against new markup (phone after an update)
    antwort = client.get('/')
    assert antwort.headers['cache-control'] == 'no-cache'
    html = antwort.text
    stand = re.search(r'/static/app\.js\?v=([0-9a-f]{12})"', html)
    assert stand and f'/static/app.css?v={stand.group(1)}"' in html
    assert client.get(f'/static/app.js?v={stand.group(1)}').status_code == 200


BEREICHE = ['bruecke', 'holodeck', 'frachtraum', 'bereitschaftsraum', 'sternenkarte', 'maschinenraum', 'logbuch']


def test_huelle_zeigt_die_sieben_bereiche_ohne_komm(client):
    html = client.get('/').text
    for b in BEREICHE:
        assert f'<a class="pille" href="#{b}" data-bereich="{b}">' in html
        assert f'<section class="bereich" data-bereich="{b}"' in html
    assert len(re.findall(r'class="pille" ', html)) == 7
    assert not re.search(r'#komm\b|data-bereich="komm"', html, re.IGNORECASE)
    # the board stays the area "Brücke": its three levels live in that section
    bruecke = html.split('data-bereich="bruecke" aria-label="Brücke">', 1)[1].split('</section>\n<section', 1)[0]
    assert all(f'id="{e}"' in bruecke for e in ('e1', 'e2', 'e3'))


def test_huelle_und_bereiche_werden_mit_inhaltsstand_ausgeliefert(client):
    html = client.get('/').text
    stand = re.search(r'/static/app\.js\?v=([0-9a-f]{12})"', html).group(1)
    dateien = ['huelle.css', 'huelle.js'] + [f'bereiche/{b}.{e}' for b in BEREICHE[1:] for e in ('css', 'js')] + ['schiffsliste.css', 'schiffsliste.js']
    for n in dateien:
        assert f'/static/{n}?v={stand}"' in html
        assert client.get(f'/static/{n}?v={stand}').status_code == 200
    # the shell loads first, the areas register with it, the board comes last
    reihe = [html.index(f'/static/{n}?v=') for n in ['huelle.js'] + [f'bereiche/{b}.js' for b in BEREICHE[1:]] + ['schiffsliste.js', 'app.js']]
    assert reihe == sorted(reihe)
    assert not re.search(r'/static/[\w/.-]+\.(?:css|js)"', html)
