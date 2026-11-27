"""Sternenkarte (#43): the flat view of the open epics per project (`projekte[].epics`), built from the
report alone. Order edges come from the driver (`nach`), the bridge asks no forge."""

from pathlib import Path

STATIC = Path(__file__).parent.parent / 'app' / 'static'


def melde(c, b):
    r = c.post('/api/bericht', json=b)
    assert r.status_code == 200, r.text


def karte(c, forge='interias/flotte-probe'):
    return {e['nr']: e for e in next(p for p in c.get('/api/tafel').json()['projekte'] if p['forge'] == forge)['epics']}


def epic(nr, stufe='wartend', **o):
    return {'nr': nr, 'titel': f'Epic {nr}', 'stufe': stufe, **o}


def test_beispiel_zeigt_nur_offene_epics_mit_stufe_prio_und_pakete(client, bericht):
    melde(client, bericht)
    k = karte(client)
    # 35 is done: no backlog
    assert sorted(k) == [36, 37, 38, 39, 40, 41, 42]
    assert k[41]['prio'] is True and k[38]['prio'] is False
    assert k[41]['stufe'] == 'wartend' and k[38]['stufe'] == 'laeuft'
    assert k[41]['issueUrl'].endswith('/issues/41')
    assert len(k[41]['pakete']) == 3 and all('url' in p for p in k[41]['pakete'])
    assert k[41]['prognose'] == {'p50': 10800, 'p90': 18000}
    assert set(k[41]) == {'id', 'nr', 'titel', 'stufe', 'prio', 'konto', 'issueUrl', 'pr', 'prUrl', 'warum', 'fragen', 'prognose', 'pakete', 'nach', 'folgen', 'imEinsatz', 'pausiert', 'prioritaet', 'pause', 'vorrang', 'merge', 'andocken', 'lage', 'aufgegeben', 'einreihen'}


def test_sortiert_nach_stufe_dann_prio_dann_nummer(client, bericht):
    melde(client, bericht)
    p = next(p for p in client.get('/api/tafel').json()['projekte'] if p['forge'] == 'interias/flotte-probe')
    assert [e['nr'] for e in p['epics']] == [40, 38, 39, 36, 37, 41, 42]


def test_kanten_und_wartende_nachfolger(client, bericht):
    melde(client, bericht)
    k = karte(client)
    assert [(x['nr'], x['offen'], x['stufe']) for x in k[41]['nach']] == [(38, True, 'laeuft'), (39, True, 'laeuft')]
    assert k[41]['nach'][0]['issueUrl'].endswith('/issues/38')
    assert k[38]['folgen'] == [41] and k[41]['folgen'] == [42] and k[42]['folgen'] == []
    # an edge to a merged epic stays, marked as no longer open
    assert [(x['nr'], x['offen'], x['stufe']) for x in k[40]['nach']] == [(35, False, 'fertig')]


def test_kante_auf_unbekanntes_epic_ist_markiert_und_selbstkante_faellt_weg(client, bericht):
    bericht['epics'] = [epic(5, nach=[9, 5]), epic(6, 'laeuft')]
    melde(client, bericht)
    k = karte(client)
    assert k[5]['nach'] == [{'nr': 9, 'titel': '', 'stufe': None, 'offen': False, 'issueUrl': bericht['url'] + '/issues/9'}]
    assert k[6]['folgen'] == []


def test_gemergt_ist_kein_backlog_aufgegeben_bleibt_am_ende(client, bericht):
    bericht['epics'] = [epic(1, 'fertig'), epic(2, 'gemergt'), epic(3, 'abgebrochen', aufgegebenAm='2026-11-20T10:00:00Z'), epic(4, 'abgebrochen', grund='Gate rot'), epic(5, nach=[3])]
    melde(client, bericht)
    k = karte(client)
    assert sorted(k) == [3, 4, 5]
    assert k[4]['warum'] == 'Gate rot' and k[4]['aufgegeben'] is None
    # its issue is open: the given-up mission stays on the map, last, with einreihen to take it back
    assert k[3]['aufgegeben'] == '2026-11-20T10:00:00Z' and k[3]['einreihen'] is None
    assert list(k)[-1] == 3
    assert k[5]['nach'][0]['offen'] is True


def test_warum_und_offene_fragen(client, bericht):
    bericht['epics'] = [epic(5, notiz='wartet auf #4: gleiche Dateien'), epic(6, 'frage', notiz='x')]
    bericht['fragen'] = [{'epic': 6, 'nr': 1, 'frage': 'Welche?', 'seit': '2026-11-20T14:00:00Z'}]
    melde(client, bericht)
    k = karte(client)
    assert k[5]['warum'] == 'wartet auf #4: gleiche Dateien' and k[5]['fragen'] == 0
    assert k[6]['fragen'] == 1


def test_aelterer_bericht_ohne_nach_baut_die_tafel_weiter(client, bericht):
    for e in bericht['epics']:
        del e['nach']
    melde(client, bericht)
    t = client.get('/api/tafel').json()
    assert t['unterwegs']['bereit'] and t['unterwegs']['laeufe']
    k = karte(client)
    assert all(e['nach'] == [] and e['folgen'] == [] for e in k.values())


def test_projekte_bleiben_getrennt_und_projekt_ohne_epics_hat_leere_liste(client, bericht):
    melde(client, bericht)
    zweit = {**bericht, 'forge': 'interias/zweit', 'url': 'https://example.org/interias/zweit', 'epics': [epic(7, nach=[41])]}
    melde(client, zweit)
    # an edge counts inside its own repository: #41 is no epic of the second project
    assert karte(client, 'interias/zweit')[7]['nach'][0]['offen'] is False
    leer = {**bericht, 'forge': 'interias/leer', 'epics': []}
    melde(client, leer)
    assert karte(client, 'interias/leer') == {}


def test_projekt_traegt_seine_prognose_fuer_die_karte(client, bericht):
    melde(client, bericht)
    p = next(p for p in client.get('/api/tafel').json()['projekte'] if p['forge'] == 'interias/flotte-probe')
    assert p['prognose']['status'] == 'ok' and p['prognose']['backlog']


def test_sternenkarte_zeichnet_aus_der_tafel_ohne_eigene_abfrage():
    js = (STATIC / 'bereiche' / 'sternenkarte.js').read_text(encoding='utf-8')
    assert 'projekte' in js and 'fetch(' not in js


def test_viele_vorgaenger_kippen_den_bericht_nicht(client, bericht):
    # a report with 200 epics may name up to 199 predecessors: no 422 for the whole report
    bericht['epics'] = [epic(1, nach=list(range(2, 100)))]
    melde(client, bericht)
    assert len(karte(client)[1]['nach']) == 98
