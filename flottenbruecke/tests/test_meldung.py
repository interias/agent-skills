import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pywebpush import WebPushException

from app import start
from app.main import Einstellung, erzeuge
from app.meldung import _meldung, inhalt, schluessel_erzeugen
from conftest import fremd, koppeln

PIN = {'X-Bruecke-Pin': '4711'}
ABO = {'endpoint': 'https://fcm.googleapis.com/fcm/send/abo-1', 'keys': {'p256dh': 'BOeffentlich', 'auth': 'geheim'}}
SCHLUESSEL = schluessel_erzeugen()


class Dienst:
    """The push service as a stand-in: records every push, answers with status per endpoint."""

    def __init__(self):
        self.gesendet: list[dict] = []
        self.status: dict[str, int] = {}

    def __call__(self, subscription_info, data, vapid_private_key, vapid_claims, ttl, timeout):
        self.gesendet.append({'endpoint': subscription_info['endpoint'], 'daten': json.loads(data), 'claims': vapid_claims})
        s = self.status.get(subscription_info['endpoint'])
        if s:
            raise WebPushException(f'Push failed: {s}', response=SimpleNamespace(status_code=s))


@pytest.fixture
def dienst():
    return Dienst()


@pytest.fixture
def baue(tmp_path, uhr, dienst):
    def baue(vapid=SCHLUESSEL):
        c = TestClient(erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr, vapid=vapid, push_senden=dienst)))
        koppeln(c)
        return c

    return baue


def abonnieren(c, abo=ABO, headers=PIN):
    return c.post('/api/push', json=abo, headers=headers)


# ---- subscribe and unsubscribe: only with a paired device


def test_abo_nur_mit_gekoppeltem_geraet(baue, bericht, dienst):
    c = baue()
    assert abonnieren(fremd(c)).status_code == 401
    assert abonnieren(c, headers={}).json() == {'ok': True}
    c.post('/api/bericht', json=bericht)
    assert [g['endpoint'] for g in dienst.gesendet] == [ABO['endpoint']]


def test_abo_nur_ueber_https(baue):
    assert abonnieren(baue(), {**ABO, 'endpoint': 'http://fcm.googleapis.com/fcm/send/abo'}).status_code == 422


@pytest.mark.parametrize('endpoint', [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/abc',
])
def test_abo_bei_bekanntem_push_dienst(baue, endpoint):
    assert abonnieren(baue(), {**ABO, 'endpoint': endpoint}).json() == {'ok': True}


@pytest.mark.parametrize('endpoint', [
    'https://192.168.1.10/',
    'https://fcm.googleapis.com.evil.example/',
    'https://evilpush.apple.com/abc',
    'https://nutzer:pw@fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
])
def test_abo_bei_anderem_ziel_abgelehnt(baue, endpoint):
    assert abonnieren(baue(), {**ABO, 'endpoint': endpoint}).status_code == 422


def test_abmelden_nur_mit_gekoppeltem_geraet_dann_kein_versand(baue, bericht, dienst):
    c = baue()
    abonnieren(c)
    assert fremd(c).post('/api/push/abmelden', json={'endpoint': ABO['endpoint']}).status_code == 401
    assert c.post('/api/push/abmelden', json={'endpoint': ABO['endpoint']}).json() == {'ok': True, 'geloescht': True}
    assert c.post('/api/push/abmelden', json={'endpoint': ABO['endpoint']}, headers=PIN).json() == {'ok': True, 'geloescht': False}
    c.post('/api/bericht', json=bericht)
    assert dienst.gesendet == []


def test_abgelaufenes_abo_wird_geloescht(baue, bericht, dienst):
    c = baue()
    zwei = {**ABO, 'endpoint': 'https://fcm.googleapis.com/fcm/send/abo-2'}
    abonnieren(c)
    abonnieren(c, zwei)
    dienst.status[ABO['endpoint']] = 410
    c.post('/api/bericht', json=bericht)
    assert len(dienst.gesendet) == 2
    bericht['fragen'][0]['seit'] = '2026-11-20T14:20:00Z'
    c.post('/api/bericht', json=bericht)
    assert [g['endpoint'] for g in dienst.gesendet[2:]] == [zwei['endpoint']]


def test_anderer_fehler_laesst_abo_stehen(baue, bericht, dienst):
    c = baue()
    abonnieren(c)
    dienst.status[ABO['endpoint']] = 500
    assert c.post('/api/bericht', json=bericht).json()['ok']
    dienst.status.clear()
    bericht['fragen'][0]['seit'] = '2026-11-20T14:20:00Z'
    c.post('/api/bericht', json=bericht)
    assert len(dienst.gesendet) == 2


# ---- when it rings: only "Braucht dich", once per event, several in one report as one push with the number


def test_einmal_je_ereignis_gebuendelt_und_nach_neustart_still(baue, bericht, dienst):
    c = baue()
    abonnieren(c)
    # the example: question of #39, blockade of #40 and the red base #37 waits for, in one report
    c.post('/api/bericht', json=bericht)
    assert [g['daten']['titel'] for g in dienst.gesendet] == ['Braucht dich: 3 neue Meldungen (flotte-probe)']
    # in the order of level 1, one short line each: what holds a whole mission first, then the longest wait
    assert dienst.gesendet[0]['daten']['text'] == 'Die Andockprüfung der Mission ist rot.\nmain ist rot: tests/routen.test.ts scheitert in api.\nWo soll die Konfigurationsdatei liegen?'
    c.post('/api/bericht', json=bericht)
    # a restart of the bridge on the same database
    baue().post('/api/bericht', json=bericht)
    assert len(dienst.gesendet) == 1
    # a new question rings alone
    bericht['fragen'].append({**bericht['fragen'][0], 'nr': 2, 'seit': '2026-11-20T14:30:00Z'})
    c.post('/api/bericht', json=bericht)
    # #243: the question in one sentence and the recommendation
    assert dienst.gesendet[1]['daten'] == {'titel': 'Wo soll die Konfigurationsdatei liegen?', 'text': '→ Empfohlen: A · config/flotte.json neben den Skript-Konfigurationen, folgt dem vorhandenen Muster · #39 (flotte-probe)'}
    assert dienst.gesendet[1]['claims']['sub'].startswith('mailto:')


def test_nur_braucht_dich(baue, bericht, dienst):
    c = baue()
    abonnieren(c)
    bericht['fragen'] = []
    for ep in bericht['epics']:
        if ep['stufe'] == 'blockiert':
            ep['stufe'] = 'laeuft'
        # the red base needs the person (its own test); a conflict the fleet solves itself (#38) does not
        if (ep.get('ursache') or {}).get('art') == 'main_rot':
            ep['ursache'] = None
    # running, queued, merged and waiting epics, the decisions and events, "Dein Schritt bald": nothing for the person
    c.post('/api/bericht', json=bericht)
    assert dienst.gesendet == []
    # a blocked epic given up does not ring either
    ep = next(e for e in bericht['epics'] if e['nr'] == 40)
    ep.update(stufe='abgebrochen', aufgegebenAm='2026-11-20T14:10:00Z')
    c.post('/api/bericht', json=bericht)
    assert dienst.gesendet == []


def test_neu_blockiert_klingelt_wieder(baue, bericht, dienst):
    c = baue()
    abonnieren(c)
    bericht['fragen'] = []
    c.post('/api/bericht', json=bericht)
    ep = next(e for e in bericht['epics'] if e['nr'] == 40)
    ep.update(stufe='laeuft', haltZeit=None)
    c.post('/api/bericht', json=bericht)
    ep.update(stufe='abgebrochen', haltZeit='2026-11-20T14:25:00Z')
    c.post('/api/bericht', json=bericht)
    assert [g['daten']['titel'] for g in dienst.gesendet] == ['Braucht dich: 2 neue Meldungen (flotte-probe)', 'Die Andockprüfung der Mission ist rot.']


# ---- content (#243): what the card says, the short line and the step; no path, no transcript


def test_inhalt_ohne_pfade_und_transkript(baue, bericht, dienst):
    c = baue()
    abonnieren(c)
    f = bericht['fragen'][0]
    f.update(frage=r'Soll C:\Users\jemand\geheim.txt gelöscht werden?', kurz=None, lage='Im Transkript steht /home/jemand/.ssh/id_rsa', roh='Wortlaut des Laufs', grund='weil')
    # a blockade of an older driver without a cause: its title, cut for the notification
    ep = next(e for e in bericht['epics'] if e['nr'] == 40)
    ep.update(ursache=None, grund=r'Gate rot in D:\repo\x', log=['10:00 Transkriptzeile'], titel='Ein sehr langer Titel einer Mission, der weit über sechzig Zeichen hinausgeht und gekürzt wird')
    c.post('/api/bericht', json=bericht)
    daten = dienst.gesendet[0]['daten']
    assert set(daten) == {'titel', 'text'}
    text = daten['titel'] + ' ' + daten['text']
    for verboten in ['geheim', 'Users', '.ssh', 'Transkript', 'Wortlaut', 'Gate rot', 'repo', 'interias/', '\\']:
        assert verboten not in text
    zeilen = daten['text'].split('\n')
    assert zeilen[0] == 'Blockiert: Ein sehr langer Titel einer Mission, der weit über sechzig Zeichen hinausgeht und gekürzt wird'[:89].rstrip() + '…'
    assert zeilen[2] == 'Soll <pfad> gelöscht werden?'


def test_inhalt_einzeln_und_ohne_titel():
    assert _meldung({'art': 'blockade', 'epic': 7, 'titel': '', 'stufe': 'abgebrochen'}) == ('Abgebrochen: #7', '→ Ursache ansehen · hält #7')
    assert inhalt([{'kurz': 'werft', 'epic': 7, 'art': 'blockade', 'titel': 'Abgebrochen: #7', 'text': '→ Ursache ansehen · hält #7'}]) == {'titel': 'Abgebrochen: #7', 'text': '→ Ursache ansehen · hält #7 (werft)'}


def test_eine_meldung_je_ursache_und_flotte_klingelt_nicht(baue, bericht, dienst):
    # #243: the red base holds #36 and #37: one push with both; the conflict the fleet solves itself rings nothing
    c = baue()
    abonnieren(c)
    bericht['fragen'] = []
    rot = next(e for e in bericht['epics'] if e['nr'] == 37)['ursache']
    for ep in bericht['epics']:
        if ep['nr'] == 40:
            ep['stufe'] = 'laeuft'
        if ep['nr'] == 36:
            ep['ursache'] = rot
    c.post('/api/bericht', json=bericht)
    assert [g['daten'] for g in dienst.gesendet] == [{'titel': 'main ist rot: tests/routen.test.ts scheitert in api.', 'text': '→ main reparieren (tests/routen.test.ts in api), dann „Erledigt“ · hält #36, #37 (flotte-probe)'}]
    # the same red base again: still; red again later (a new since): it rings anew
    c.post('/api/bericht', json=bericht)
    assert len(dienst.gesendet) == 1
    for ep in bericht['epics']:
        if ep['nr'] in (36, 37):
            ep['ursache'] = {**rot, 'seit': '2026-11-20T14:30:00Z'}
    c.post('/api/bericht', json=bericht)
    assert len(dienst.gesendet) == 2


# ---- optional: without the VAPID key no push, no service, the bridge as before


def test_ohne_vapid_kein_versand(baue, bericht, dienst):
    c = baue(vapid='')
    assert c.get('/api/tafel').json()['push'] is None
    assert abonnieren(c).status_code == 409
    assert c.post('/api/bericht', json=bericht).json() == {'ok': True, 'neu': True}
    assert dienst.gesendet == []
    # switched on later: what the bridge saw before does not ring
    c2 = baue()
    abonnieren(c2)
    c2.post('/api/bericht', json=bericht)
    assert dienst.gesendet == []


def test_oeffentlicher_schluessel_in_der_tafel(baue):
    import base64

    k = baue().get('/api/tafel').json()['push']
    roh = base64.urlsafe_b64decode(k + '=' * (-len(k) % 4))
    assert len(roh) == 65 and roh[0] == 4


def test_start_ohne_zertifikat_ueber_http():
    o = start.optionen({})
    assert 'ssl_certfile' not in o and 'ssl_keyfile' not in o
    assert o['port'] == 8000 and o['factory'] is True
    assert start.optionen({'BRUECKE_ZERT': '', 'BRUECKE_ZERT_SCHLUESSEL': ''}) == o
    assert start.adresse({}) == 'http://127.0.0.1:8000/healthz'


def test_start_mit_zertifikat_ueber_https():
    o = start.optionen({'BRUECKE_ZERT': '/zert/bruecke.pem', 'BRUECKE_ZERT_SCHLUESSEL': '/zert/bruecke-key.pem'})
    assert o['ssl_certfile'] == '/zert/bruecke.pem' and o['ssl_keyfile'] == '/zert/bruecke-key.pem'
    assert start.adresse({'BRUECKE_ZERT': 'a', 'BRUECKE_ZERT_SCHLUESSEL': 'b'}).startswith('https://')
    with pytest.raises(SystemExit):
        start.optionen({'BRUECKE_ZERT': '/zert/bruecke.pem'})


# ---- installable: service worker at the root, manifest


def test_service_worker_und_manifest(baue):
    c = baue(vapid='')
    sw = c.get('/sw.js')
    assert sw.status_code == 200 and 'javascript' in sw.headers['content-type']
    assert "addEventListener('push'" in sw.text and 'notificationclick' in sw.text
    m = c.get('/static/manifest.webmanifest').json()
    assert m['start_url'] == '/' and m['scope'] == '/' and m['display'] == 'standalone'
    assert {'192x192', '512x512'} <= {i['sizes'] for i in m['icons'] if i['type'] == 'image/png'}


def test_schluessel_taugt_fuer_pywebpush_ohne_netz(tmp_path, monkeypatch):
    """The generated key signs and encrypts with the real pywebpush; curl=True builds the request without sending it."""
    import os

    # curl=True leaves encrypted.data in the working folder
    monkeypatch.chdir(tmp_path)

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from pywebpush import webpush

    from app.meldung import b64

    geraet = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    abo = {'endpoint': 'https://push.example/abo/1', 'keys': {'p256dh': b64(geraet), 'auth': b64(os.urandom(16))}}
    anfrage = webpush(abo, json.dumps({'titel': 't', 'text': 'x'}), vapid_private_key=SCHLUESSEL, vapid_claims={'sub': 'mailto:flottenbruecke@localhost'}, ttl=60, curl=True)
    assert 'authorization: vapid t=' in anfrage and 'content-encoding: aes128gcm' in anfrage
