"""#46 Geräteanmeldung: what the person writes needs two keys, a paired device with the right for it and the PIN.
A device pairs once with the PIN (a random key as a cookie, the bridge keeps only its hash); rights, unpairing and
releasing the emergency stop go only through the entry of the machine itself (RECHNERPORT, on 127.0.0.1 only)."""
import hashlib
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.main import FERNPORT, GERAET_COOKIE, RECHNERPORT, Einstellung, erzeuge
from conftest import am_rechner, koppeln

PROBE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}
EINREIHEN = {'forge': PROBE, 'epic': 40, 'art': 'einreihen'}


@pytest.fixture
def app(tmp_path, uhr):
    return erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr))


@pytest.fixture
def lan(app, bericht):
    c = TestClient(app)
    c.post('/api/bericht', json=bericht)
    return c


def rechte(app, id_, antworten=True, handeln=True, pin=PIN):
    return TestClient(app, base_url=f'http://testserver:{RECHNERPORT}').post(f'/api/geraete/{id_}/rechte', json={'antworten': antworten, 'handeln': handeln}, headers=pin)


# ---- pairing


def test_koppeln_setzt_zufaelligen_schluessel_als_strengen_cookie_und_speichert_nur_den_hash(app, lan, tmp_path):
    r = lan.post('/api/geraete/koppeln', json={'name': 'Handy'}, headers=PIN)
    assert r.status_code == 200
    kopf = r.headers['set-cookie']
    teile = {t.strip().split('=')[0].lower() for t in kopf.split(';')}
    assert {'httponly', 'secure', 'samesite'} <= teile
    assert 'samesite=strict' in kopf.lower() and 'path=/' in kopf.lower()
    schluessel = r.cookies[GERAET_COOKIE]
    assert len(schluessel) >= 40
    # a second device gets another key
    zweiter = TestClient(app).post('/api/geraete/koppeln', json={'name': 'Tablet'}, headers=PIN).cookies[GERAET_COOKIE]
    assert zweiter != schluessel
    db = sqlite3.connect(tmp_path / 'b.db')
    zeilen = db.execute('select hash from geraete order by id').fetchall()
    assert zeilen[0][0] == hashlib.sha256(schluessel.encode()).hexdigest()
    alles = '\n'.join(str(z) for t in ('geraete', 'geraete_logbuch') for z in db.execute(f'select * from {t}'))
    assert schluessel not in alles and zweiter not in alles
    # the board never shows a hash
    assert 'hash' not in r.json()['geraet']
    assert all('hash' not in g for g in lan.get('/api/tafel').json()['geraete'])


@pytest.mark.parametrize('pin', [None, '0000'])
def test_koppeln_nur_mit_der_pin(lan, pin):
    r = lan.post('/api/geraete/koppeln', json={'name': 'Handy'}, headers={'X-Bruecke-Pin': pin} if pin else {})
    assert r.status_code == 403
    assert GERAET_COOKIE not in r.cookies
    assert lan.get('/api/tafel').json()['geraete'] == []


def test_neues_geraet_darf_ansehen_und_antworten_aber_nicht_handeln(lan, bericht):
    g = koppeln(lan, handeln=False)
    assert (g['antworten'], g['handeln']) == (True, False)
    t = lan.get('/api/tafel').json()
    assert t['geraet']['id'] == g['id'] and t['amRechner'] is False
    r = lan.post('/api/handlung', json=EINREIHEN, headers=PIN)
    assert r.status_code == 403 and r.headers['x-bruecke-grund'] == 'recht'
    assert lan.post('/api/pin', headers=PIN).status_code == 204


# ---- rights only on the machine


def test_rechte_und_entkoppeln_nur_ueber_den_rechner(app, lan):
    g = koppeln(lan, handeln=False)
    for pfad, body in ((f"/api/geraete/{g['id']}/rechte", {'antworten': True, 'handeln': True}), (f"/api/geraete/{g['id']}/entkoppeln", None)):
        # from the LAN, also from the paired device with the PIN: 403
        r = lan.post(pfad, json=body, headers=PIN)
        assert r.status_code == 403 and 'Rechner' in r.json()['detail'], pfad
    # a client in the LAN that claims to be the machine stays in the LAN
    vorgetaeuscht = TestClient(app, client=('127.0.0.1', 50000))
    assert vorgetaeuscht.post(f"/api/geraete/{g['id']}/rechte", json={'antworten': True, 'handeln': True}, headers={**PIN, 'Host': f'localhost:{RECHNERPORT}', 'X-Forwarded-For': '127.0.0.1'}).status_code == 403
    assert lan.get('/api/tafel').json()['geraet']['handeln'] is False
    # on the machine without PIN nothing either
    assert rechte(app, g['id'], pin={}).status_code == 403
    assert rechte(app, g['id']).status_code == 200
    assert lan.get('/api/tafel').json()['geraet']['handeln'] is True
    assert lan.post('/api/handlung', json=EINREIHEN, headers=PIN).status_code == 200
    assert rechte(app, 999).status_code == 404


def test_rechner_nimmt_das_recht_wieder(app, lan):
    g = koppeln(lan)
    assert rechte(app, g['id'], antworten=False, handeln=False).status_code == 200
    assert lan.post('/api/handlung', json=EINREIHEN, headers=PIN).status_code == 403
    assert lan.post('/api/antwort', json={'forge': PROBE, 'epic': 39, 'nr': 1, 'seit': '2026-11-20T13:52:30Z', 'option': None, 'text': 'A'}, headers=PIN).status_code == 403


# ---- two keys for each action


def test_jede_handlung_verlangt_geraet_mit_recht_und_pin(app, lan):
    fremd = TestClient(app)
    r = fremd.post('/api/handlung', json=EINREIHEN, headers=PIN)
    assert r.status_code == 401 and r.headers['x-bruecke-grund'] == 'geraet'
    # a made-up key is no device either
    fremd.cookies.set(GERAET_COOKIE, 'erfunden')
    assert fremd.post('/api/handlung', json=EINREIHEN, headers=PIN).status_code == 401
    g = koppeln(lan)
    r = lan.post('/api/handlung', json=EINREIHEN, headers={'X-Bruecke-Pin': '0000'})
    assert r.status_code == 403 and r.headers['x-bruecke-grund'] == 'pin'
    assert lan.post('/api/handlung', json=EINREIHEN).status_code == 403
    assert lan.post('/api/handlung', json=EINREIHEN, headers=PIN).status_code == 200
    # unpaired on the machine: the key is worth nothing from now on
    assert am_rechner(lan).post(f"/api/geraete/{g['id']}/entkoppeln", headers=PIN).status_code == 200
    r = lan.post('/api/handlung', json={**EINREIHEN, 'art': 'aufgeben'}, headers=PIN)
    assert r.status_code == 401
    assert lan.get('/api/tafel').json()['geraet'] is None


@pytest.mark.parametrize('pfad, body', [
    ('/api/werft/handlung', {'rechner': 'r', 'forge': PROBE, 'stack': None, 'art': 'einstellen', 'text': '{"name": "an", "wert": false}'}),
    ('/api/chat/1/anlegen', {'von': 1, 'starten': False}),
])
def test_auch_werft_und_missionen_anlegen_sind_handlungen(app, lan, pfad, body):
    koppeln(lan, handeln=False)
    r = lan.post(pfad, json=body, headers=PIN)
    assert r.status_code == 403 and r.headers['x-bruecke-grund'] == 'recht'


# ---- Origin


def test_schreibende_anfrage_mit_fremdem_origin_abgelehnt(app, lan, bericht):
    koppeln(lan)
    for origin in ('https://boese.example', 'null', 'http://testserver.example', f'http://testserver:{RECHNERPORT}'):
        r = lan.post('/api/handlung', json=EINREIHEN, headers={**PIN, 'Origin': origin})
        assert r.status_code == 403 and 'Origin' in r.json()['detail'], origin
    assert lan.post('/api/geraete/koppeln', json={'name': 'x'}, headers={**PIN, 'Origin': 'https://boese.example'}).status_code == 403
    assert lan.post('/api/handlung', json=EINREIHEN, headers={**PIN, 'Origin': 'http://testserver'}).status_code == 200


def test_treiber_mit_token_bleibt_unberuehrt(tmp_path, uhr, bericht):
    c = TestClient(erzeuge(Einstellung(db=str(tmp_path / 't.db'), pin='4711', token='geheim', uhr=uhr)))
    t = {'X-Bruecke-Token': 'geheim'}
    assert c.post('/api/bericht', json=bericht, headers=t).status_code == 200
    assert c.get('/api/handlungen', params={'forge': PROBE}, headers=t).status_code == 200
    assert c.get('/api/antworten', params={'forge': PROBE}, headers=t).status_code == 200
    # a page that fetches in the driver's place is refused like any foreign one
    assert c.get('/api/handlungen', params={'forge': PROBE}, headers={**t, 'Origin': 'https://boese.example'}).status_code == 403


# ---- emergency stop


def test_not_aus_loest_jedes_gekoppelte_geraet_nur_der_rechner_loest_ihn(app, lan, tmp_path, uhr):
    assert TestClient(app).post('/api/notaus').status_code == 401
    koppeln(lan)
    schwach = TestClient(app)
    koppeln(schwach, handeln=False, name='Tablet')
    # without a right and without the PIN: stopping must be quick
    assert schwach.post('/api/notaus').status_code == 200
    t = lan.get('/api/tafel').json()
    assert t['notaus']['geraet'] == 'Tablet'
    for pfad, body in (('/api/handlung', EINREIHEN), ('/api/antwort', {'forge': PROBE, 'epic': 39, 'nr': 1, 'seit': '2026-11-20T13:52:30Z', 'option': None, 'text': 'A'})):
        r = lan.post(pfad, json=body, headers=PIN)
        assert r.status_code == 423 and 'Not-Aus' in r.json()['detail'], pfad
    assert TestClient(app).post('/api/geraete/koppeln', json={'name': 'neu'}, headers=PIN).status_code == 423
    # from the LAN nobody releases it, also not with the PIN and the right
    assert lan.post('/api/notaus/loesen', headers=PIN).status_code == 403
    # it holds over a restart of the bridge
    neu = TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr)))
    neu.cookies.set(GERAET_COOKIE, lan.cookies[GERAET_COOKIE])
    assert neu.post('/api/handlung', json=EINREIHEN, headers=PIN).status_code == 423
    assert am_rechner(lan).post('/api/notaus/loesen', headers={'X-Bruecke-Pin': '0000'}).status_code == 403
    assert am_rechner(lan).post('/api/notaus/loesen', headers=PIN).status_code == 200
    assert am_rechner(lan).post('/api/notaus/loesen', headers=PIN).status_code == 409
    assert lan.get('/api/tafel').json()['notaus'] is None
    assert lan.post('/api/handlung', json=EINREIHEN, headers=PIN).status_code == 200


# ---- log


def test_jede_handlung_mit_geraet_zeit_und_befehl_im_logbuch(app, lan, uhr):
    koppeln(lan, name='Handy')
    assert lan.post('/api/handlung', json=EINREIHEN, headers=PIN).status_code == 200
    # a refused one is no action
    lan.post('/api/handlung', json=EINREIHEN, headers={'X-Bruecke-Pin': '0000'})
    lan.post('/api/notaus')
    am_rechner(lan).post('/api/notaus/loesen', headers=PIN)
    log = lan.get('/api/tafel').json()['geraeteLogbuch']
    befehle = [(x['geraet'], x['befehl'].split(' ')[0]) for x in log]
    assert befehle[:3] == [('Rechner', '/api/notaus/loesen'), ('Handy', '/api/notaus'), ('Handy', '/api/handlung')]
    h = log[2]
    assert h['zeit'] == uhr.t.isoformat(timespec='seconds')
    assert '"art":"einreihen"' in h['befehl'] and f'"forge":"{PROBE}"' in h['befehl'] and '"epic":40' in h['befehl']
    assert sum(1 for x in log if x['befehl'].startswith('/api/handlung')) == 1


# ---- the remote entry


def test_ueber_den_fernweg_weder_koppeln_noch_handeln(app, lan):
    koppeln(lan)
    fern = TestClient(app, base_url=f'http://testserver:{FERNPORT}')
    fern.cookies.set(GERAET_COOKIE, lan.cookies[GERAET_COOKIE])
    for pfad, body in (('/api/geraete/koppeln', {'name': 'Fern'}), ('/api/handlung', EINREIHEN), ('/api/notaus', None), ('/api/geraete/1/rechte', {'antworten': True, 'handeln': True})):
        r = fern.post(pfad, json=body, headers=PIN)
        assert r.status_code == 403 and 'nur Ansicht' in r.json()['detail'], pfad
    assert len(lan.get('/api/tafel').json()['geraete']) == 1
    assert fern.get('/api/tafel').json()['amRechner'] is False
