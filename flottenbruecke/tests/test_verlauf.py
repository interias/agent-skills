"""Tag J: the history of a mission's runs. Only the driver writes it, a paired device reads it, also over the remote
entry; no push ever carries its text."""

import copy
import json
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import FERNPORT, Einstellung, erzeuge

from app.meldung import schluessel_erzeugen
from conftest import am_rechner, fremd, koppeln

BEISPIEL = json.loads((Path(__file__).parent.parent / 'beispiel' / 'verlauf.json').read_text(encoding='utf-8'))
PROBE = 'interias/flotte-probe'


@pytest.fixture
def verlauf():
    return copy.deepcopy(BEISPIEL[0])


def lesen(c, forge=PROBE, epic=482):
    return c.get('/api/verlauf', params={'forge': forge, 'epic': epic})


def test_beispiel_kommt_an_und_ein_gekoppeltes_geraet_liest_es(client, verlauf):
    r = client.post('/api/verlauf', json=verlauf)
    assert r.json() == {'ok': True, 'eintraege': len(verlauf['eintraege'])}
    v = lesen(client).json()
    assert (v['forge'], v['epic'], v['stand'], v['empfangen']) == (PROBE, 482, verlauf['stand'], '2026-11-20T14:31:10+00:00')
    assert v['eintraege'][0] == verlauf['eintraege'][0]
    # fields the driver left out stay out, the rest arrive as sent
    gruppe = next(e for e in v['eintraege'] if e['id'] == 'toolu_481')
    assert gruppe == {'id': 'toolu_481', 'art': 'gruppe', 'zeit': '2026-11-20T13:52:00Z', 'rolle': 'Ingenieur', 'paket': '#481', 'text': 'Stanze parallel', 'stand': 'laeuft'}


def test_der_neue_verlauf_ersetzt_den_alten(client, verlauf):
    client.post('/api/verlauf', json=verlauf)
    verlauf['eintraege'] = verlauf['eintraege'][-2:]
    verlauf['stand'] = '2026-11-20T14:31:00Z'
    client.post('/api/verlauf', json=verlauf)
    v = lesen(client).json()
    assert [e['id'] for e in v['eintraege']] == ['toolu_b2', 'toolu_g1']
    assert v['stand'] == '2026-11-20T14:31:00Z'


def test_ohne_verlauf_404(client):
    assert lesen(client).status_code == 404


def test_ein_ungekoppeltes_geraet_liest_nichts(client, verlauf):
    client.post('/api/verlauf', json=verlauf)
    r = lesen(fremd(client))
    assert r.status_code == 401
    assert r.headers['X-Bruecke-Grund'] == 'geraet'


def test_der_rechner_selbst_liest_ohne_kopplung(client, verlauf):
    client.post('/api/verlauf', json=verlauf)
    assert lesen(am_rechner(fremd(client))).status_code == 200


def test_ueber_den_fernweg_liest_ein_gekoppeltes_geraet_schreibt_aber_nicht(client, verlauf):
    client.post('/api/verlauf', json=verlauf)
    fern = TestClient(client.app, base_url=f'http://testserver:{FERNPORT}')
    koppeln(fern, handeln=False)
    assert lesen(fern).status_code == 200
    assert fern.post('/api/verlauf', json=verlauf).status_code == 403


def test_nur_der_treiber_mit_token_schreibt(bruecke, verlauf):
    c = bruecke(token='geheim')
    assert c.post('/api/verlauf', json=verlauf).status_code == 401
    assert c.post('/api/verlauf', json=verlauf, headers={'X-Bruecke-Token': 'geheim'}).status_code == 200


@pytest.mark.parametrize('kaputt', [
    {'art': 'ausgabe'},
    {'text': 'x' * 2001},
    {'roh': 'x' * 2001},
    {'stand': 'irgendwas'},
])
def test_was_nicht_zum_vertrag_passt_wird_abgelehnt(client, verlauf, kaputt):
    verlauf['eintraege'][0].update(kaputt)
    assert client.post('/api/verlauf', json=verlauf).status_code == 422


def test_hoechstens_400_eintraege(client, verlauf):
    verlauf['eintraege'] = [{'id': str(i), 'art': 'text', 'text': 'x'} for i in range(401)]
    assert client.post('/api/verlauf', json=verlauf).status_code == 422


def test_ein_alter_verlauf_geht_nach_einer_woche(client, verlauf, uhr):
    client.post('/api/verlauf', json=verlauf)
    uhr.t += timedelta(days=8)
    andere = {**verlauf, 'epic': 479}
    client.post('/api/verlauf', json=andere)
    assert lesen(client).status_code == 404
    assert lesen(client, epic=479).status_code == 200


def test_der_verlauf_loest_keine_push_nachricht_aus(tmp_path, uhr, verlauf, bericht):
    gesendet = []
    c = TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr, vapid=schluessel_erzeugen(), push_senden=lambda **k: gesendet.append(k))))
    koppeln(c)
    assert c.post('/api/push', json={'endpoint': 'https://fcm.googleapis.com/fcm/send/abo-1', 'keys': {'p256dh': 'BOeffentlich', 'auth': 'geheim'}}).status_code == 200
    c.post('/api/bericht', json=bericht)
    vorher = len(gesendet)
    assert vorher  # the report's questions ring
    verlauf['eintraege'].append({'id': 'frage:neu', 'art': 'frage', 'text': 'Geheime Frage im Verlauf'})
    assert c.post('/api/verlauf', json=verlauf).status_code == 200
    assert len(gesendet) == vorher
    assert 'Geheime Frage' not in json.dumps(c.get('/api/tafel').json())
