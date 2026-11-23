"""#154: the stand of bridge and driver on every page and in the Maschinenraum, a newer main as a hint, and the
button "Einspielen und Treiber neu starten": an action with the PIN the driver fetches (agent-skills/ADR-0005),
for one driver or all; without the PIN only shown."""

import copy
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import Einstellung, erzeuge

FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}
STATIC = Path(__file__).parent.parent / 'app' / 'static'


def tafel(c):
    return c.get('/api/tafel').json()


def einspielen(c, forge=FORGE, pin='4711'):
    body = {'forge': forge, 'epic': 0, 'art': 'einspielen', 'nr': None, 'seit': None, 'text': 'egal'}
    return c.post('/api/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def offene(c, forge=FORGE):
    return c.get('/api/handlungen', params={'forge': forge}).json()


def test_bericht_und_tafel_nennen_den_stand_von_treiber_und_bruecke(tmp_path, uhr, bericht):
    c = TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr, commit='0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c', datum='2026-11-21T09:00:00+01:00')))
    assert c.post('/api/bericht', json=bericht).status_code == 200
    t = tafel(c)
    assert t['bruecke'] == {'commit': '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c', 'datum': '2026-11-21T09:00:00+01:00'}
    v = t['projekte'][0]['version']
    assert v['commit'] == bericht['version']['commit']
    assert v['neu']['titel'] == bericht['version']['neu']['titel']
    assert t['projekte'][0]['einspielen'] is None


def test_ohne_stand_sagt_die_bruecke_nichts_erfundenes(client, bericht):
    del bericht['version']
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    assert t['bruecke'] == {'commit': None, 'datum': None}
    assert t['projekte'][0]['version'] is None


def test_einspielen_nur_mit_pin_der_treiber_holt_es_ab_mit_dem_stand_der_bruecke(tmp_path, uhr, bericht):
    c = TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr, commit='0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c')))
    c.post('/api/bericht', json=bericht)
    assert einspielen(c, pin=None).status_code == 401
    assert einspielen(c, pin='0000').status_code == 401
    assert offene(c) == []
    r = einspielen(c)
    assert r.status_code == 200 and r.json()['ok']
    # on its way: the button says it waits for the driver
    assert tafel(c)['projekte'][0]['einspielen']['abgeholt'] is False
    geholt = offene(c)
    # the text is the bridge's, never the page's: the commit of its image for "build only when flottenbruecke/ changed"
    assert [(h['epic'], h['art'], h['nr'], h['seit'], json.loads(h['text'])) for h in geholt] == [(0, 'einspielen', None, None, {'bruecke': '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c'})]
    assert einspielen(c).status_code == 409
    c.post(f"/api/handlungen/{geholt[0]['id']}/quittung")
    x = next(x for x in tafel(c)['erledigt'] if x['art'] == 'handlung')
    assert (x['epic'], x['handlung']) == (None, 'einspielen')


def test_ohne_gesetzte_pin_nur_anzeige(bruecke, bericht):
    c = bruecke(pin='')
    c.post('/api/bericht', json=bericht)
    assert einspielen(c).status_code == 403
    assert tafel(c)['pin'] is False


def test_aelterer_treiber_oder_schon_beim_anhalten(client, bericht):
    alt = copy.deepcopy(bericht)
    del alt['version']
    client.post('/api/bericht', json=alt)
    assert einspielen(client).status_code == 409
    assert einspielen(client, forge='unbekannt/x').status_code == 404
    bericht['version']['einspielen'] = {'seit': '2026-11-20T14:30:00Z', 'wartetAuf': [38]}
    client.post('/api/bericht', json=bericht)
    r = einspielen(client)
    assert r.status_code == 409 and 'hält schon' in r.json()['detail']


def test_fuer_alle_eine_handlung_je_treiber_mit_stand(client, bericht):
    client.post('/api/bericht', json=bericht)
    zweiter = copy.deepcopy(bericht)
    zweiter['forge'] = 'interias/zweites'
    client.post('/api/bericht', json=zweiter)
    alt = copy.deepcopy(bericht)
    alt['forge'] = 'interias/alt'
    del alt['version']
    client.post('/api/bericht', json=alt)
    r = einspielen(client, forge='alle')
    assert r.status_code == 200 and len(r.json()['ids']) == 2
    assert [h['art'] for h in offene(client)] == ['einspielen']
    assert [h['art'] for h in offene(client, 'interias/zweites')] == ['einspielen']
    assert offene(client, 'interias/alt') == []


def test_der_vertrag_traegt_die_version():
    beispiel = json.loads((Path(__file__).parent.parent / 'beispiel' / 'bericht.json').read_text(encoding='utf-8'))
    assert set(beispiel['version']) == {'commit', 'datum', 'installiert', 'gestartet', 'neu', 'geprueft', 'einspielen'}
    assert set(beispiel['version']['neu']) == {'commit', 'datum', 'titel'}


def test_seite_zeigt_den_stand_im_fuss_und_den_knopf_im_maschinenraum():
    html = (STATIC / 'index.html').read_text(encoding='utf-8')
    assert 'id="fuss-stand"' in html
    mr = (STATIC / 'bereiche' / 'maschinenraum.js').read_text(encoding='utf-8')
    assert 'Einspielen und Treiber neu starten' in mr
    assert 'Neuer Stand verfügbar' in mr
    assert "art: 'einspielen'" in mr
