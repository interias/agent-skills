"""Holodeck (#44): the prototypes the driver sends, delivered only from the store and sealed off."""

import asyncio
import copy
import json
import re
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import Einstellung, erzeuge

BEISPIEL = json.loads((Path(__file__).parent.parent / 'beispiel' / 'holodeck.json').read_text(encoding='utf-8'))
HOLODECK_JS = (Path(__file__).parent.parent / 'app' / 'static' / 'bereiche' / 'holodeck.js').read_text(encoding='utf-8')
PROBE = 'interias/flotte-probe'


@pytest.fixture
def satz():
    return copy.deepcopy(BEISPIEL)


def senden(c, body, token=None):
    return c.post('/api/holodeck', json=body, headers={'X-Bruecke-Token': token} if token else {})


def mit_beispiel(c, satz):
    for body in satz:
        assert senden(c, body).status_code == 200


def eine(name, inhalt='<!doctype html><title>x</title><p>x</p>'):
    return {'name': name, 'titel': 'x', 'geaendert': '2026-11-20T10:00:00Z', 'inhalt': inhalt}


# ---- receive and list

def test_beispiel_landet_ohne_inhalt_auf_der_tafel(client, satz):
    mit_beispiel(client, satz)
    t = client.get('/api/tafel').json()
    assert [(p['forge'], p['name']) for p in t['prototypen']] == [(PROBE, 'anmeldung-mobil.html'), (PROBE, 'startseite.html'), ('interias/sternwarte', 'sternkarte.html')]
    p = t['prototypen'][1]
    assert p == {'forge': PROBE, 'kurz': 'flotte-probe', 'name': 'startseite.html', 'titel': 'Startseite – Entwurf A', 'geaendert': '2026-11-20T13:58:12Z', 'url': '/holodeck/interias/flotte-probe/startseite.html'}
    assert 'inhalt' not in json.dumps(t['prototypen'])


def test_ohne_prototypen_ist_die_liste_leer(client):
    assert client.get('/api/tafel').json()['prototypen'] == []


def test_der_satz_ersetzt_den_vorigen(client, satz):
    mit_beispiel(client, satz)
    satz[0]['dateien'] = satz[0]['dateien'][:1]
    assert senden(client, satz[0]).json() == {'ok': True, 'dateien': 1}
    namen = [(p['forge'], p['name']) for p in client.get('/api/tafel').json()['prototypen']]
    assert namen == [(PROBE, 'startseite.html'), ('interias/sternwarte', 'sternkarte.html')]
    assert client.get('/holodeck/interias/flotte-probe/anmeldung-mobil.html').status_code == 404
    # an empty set clears the project
    senden(client, {'forge': PROBE, 'dateien': []})
    assert [p['forge'] for p in client.get('/api/tafel').json()['prototypen']] == ['interias/sternwarte']


def test_holodeck_braucht_den_treiber_token(bruecke, satz):
    c = bruecke(token='geheim')
    assert senden(c, satz[0]).status_code == 401
    assert senden(c, satz[0], token='falsch').status_code == 401
    assert senden(c, satz[0], token='geheim').status_code == 200


@pytest.mark.parametrize('name', ['../x.html', '..\\x.html', 'a/b.html', 'a\\b.html', '.versteckt.html', 'x.htm', 'x.HTML', 'x.html.js', 'x.html\n', '%2e%2e%2fx.html', 'mit leer.html', 'ä.html', '', 'x' * 102 + '.html', 'C:x.html'])
def test_dateiname_nach_fester_regel(client, name):
    assert senden(client, {'forge': PROBE, 'dateien': [eine(name)]}).status_code == 422


def test_grenzen_beim_empfang(client):
    assert senden(client, {'forge': PROBE, 'dateien': [eine(f'p{i}.html') for i in range(50)]}).status_code == 200
    assert senden(client, {'forge': PROBE, 'dateien': [eine(f'p{i}.html') for i in range(51)]}).status_code == 422
    assert senden(client, {'forge': PROBE, 'dateien': [eine('gross.html', 'x' * (2 * 1024 * 1024 + 1))]}).status_code == 422
    assert senden(client, {'forge': PROBE, 'dateien': [eine('a.html'), eine('a.html')]}).status_code == 422
    assert senden(client, {'forge': '../etc', 'dateien': []}).status_code == 422


# ---- delivery: only from the store, sealed off

def test_auslieferung_im_abgeschotteten_rahmen(client, satz):
    mit_beispiel(client, satz)
    r = client.get('/holodeck/interias/flotte-probe/startseite.html')
    assert r.status_code == 200 and r.text == satz[0]['dateien'][0]['inhalt']
    assert r.headers['content-type'].startswith('text/html')
    csp = [x.strip() for x in r.headers['content-security-policy'].split(';')]
    assert 'sandbox allow-scripts' in csp
    assert 'allow-same-origin' not in r.headers['content-security-policy']
    for regel in ("connect-src 'none'", "form-action 'none'", "frame-ancestors 'self'", "default-src 'none'"):
        assert regel in csp
    assert r.headers['x-content-type-options'] == 'nosniff'
    assert r.headers['referrer-policy'] == 'no-referrer'


AUSBRUECHE = [
    '/holodeck/interias/flotte-probe/fehlt.html',
    '/holodeck/interias/sternwarte/startseite.html',
    '/holodeck/interias/flotte-probe/startseite.htm',
    '/holodeck/interias/flotte-probe/STARTSEITE.html',
    '/holodeck/interias/flotte-probe/%2e%2e',
    '/holodeck/interias/flotte-probe/%2e%2e%2f%2e%2e%2fapi%2ftafel',
    '/holodeck/interias/flotte-probe/..%2f..%2f..%2fapp%2fmain.py',
    '/holodeck/interias/flotte-probe/%252e%252e%252fmain.py',
    '/holodeck/interias/flotte-probe/..%5c..%5capp%5cmain.py',
    '/holodeck/interias/flotte-probe/startseite.html%00.txt',
    '/holodeck/interias/%2e%2e/startseite.html',
    '/holodeck/%2e%2e/%2e%2e/static%2findex.html',
    '/holodeck/interias/flotte-probe/static',
    '/holodeck/interias/flotte-probe/index.html',
    '/holodeck/interias/flotte-probe',
    '/holodeck/interias/flotte-probe/a/startseite.html',
]


@pytest.mark.parametrize('pfad', AUSBRUECHE)
def test_kein_pfad_ausbruch(client, satz, pfad):
    mit_beispiel(client, satz)
    r = client.get(pfad)
    assert r.status_code == 404
    assert '<html' not in r.text and 'import' not in r.text


def test_kein_pfad_ausbruch_mit_rohen_punkten(client, satz):
    """Dot segments the client would normalise: straight to the app, as a raw request could send them."""
    mit_beispiel(client, satz)
    app = client.app

    def roh(pfad):
        antwort = {}

        async def empfangen():
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        async def senden_(m):
            if m['type'] == 'http.response.start':
                antwort['status'] = m['status']

        scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1', 'method': 'GET', 'scheme': 'http', 'path': pfad, 'raw_path': pfad.encode(), 'root_path': '', 'query_string': b'', 'headers': [], 'client': ('t', 1), 'server': ('t', 80)}
        asyncio.run(app(scope, empfangen, senden_))
        return antwort['status']

    for pfad in ['/holodeck/interias/flotte-probe/../../../app/main.py', '/holodeck/interias/flotte-probe/..', '/holodeck/../static/index.html', '/holodeck/interias/../flotte-probe/startseite.html', '/holodeck/interias/flotte-probe/..\\..\\app\\main.py']:
        assert roh(pfad) == 404, pfad
    assert roh('/holodeck/interias/flotte-probe/startseite.html') == 200


# ---- no script access to the bridge

def test_bruecken_api_sendet_keine_cors_koepfe(client, satz):
    mit_beispiel(client, satz)
    # a prototype runs in the opaque origin "null": without these headers it cannot read an answer
    for r in [client.get('/api/tafel', headers={'Origin': 'null'}), client.options('/api/antwort', headers={'Origin': 'null', 'Access-Control-Request-Method': 'POST'}), client.get('/holodeck/interias/flotte-probe/startseite.html', headers={'Origin': 'null'})]:
        assert not any(k.lower().startswith('access-control-') for k in r.headers)


def test_antworten_ohne_pin_bleibt_gesperrt(client, bericht):
    client.post('/api/bericht', json=bericht)
    body = {'forge': PROBE, 'epic': 39, 'nr': 1, 'seit': '2026-11-20T13:52:30Z', 'option': 'A', 'text': None}
    assert client.post('/api/antwort', json=body, headers={'Origin': 'null'}).status_code == 401
    assert client.post('/api/handlung', json={'forge': PROBE, 'epic': 40, 'art': 'einreihen'}, headers={'Origin': 'null'}).status_code == 401


def test_holodeck_skript_setzt_den_rahmen_ohne_same_origin():
    # the view: scripts yes, same origin, top navigation, forms and popups no; the preview: nothing at all
    rahmen = re.findall(r'<iframe[^>]*>', HOLODECK_JS)
    assert rahmen, 'kein Rahmen im Holodeck-Skript'
    assert all(re.search(r'\bsandbox="(?:allow-scripts)?"', r) for r in rahmen)
    assert any('sandbox="allow-scripts"' in r and 'referrerpolicy="no-referrer"' in r for r in rahmen)
    assert any('sandbox=""' in r and 'loading="lazy"' in r for r in rahmen)
    for verboten in ('allow-same-origin', 'allow-top-navigation', 'allow-forms', 'allow-popups', 'allow-modals'):
        assert verboten not in HOLODECK_JS
    # no other way to set the attribute
    assert not re.search(r'\.sandbox\b|setAttribute\(\s*[\'"]sandbox', HOLODECK_JS)


# ---- an old volume

def test_holodeck_auf_einem_alten_volume(tmp_path, uhr, satz):
    """A database of v2 without the table prototypen: it is added, nothing else changes."""
    db = tmp_path / 'v2.db'
    con = sqlite3.connect(db)
    con.executescript("""
create table projekte (forge text primary key, angelegt text not null, empfangen text not null, bericht text not null);
create table stufen (forge text not null, nr integer not null, stufe text not null, seit text not null, primary key (forge, nr));
create table antworten (id integer primary key autoincrement, forge text not null, epic integer not null, nr integer not null,
  seit text not null, option text, text text not null, zeit text not null, abgeholt text, quittiert text, unique (forge, epic, nr, seit));
create table handlungen (id integer primary key autoincrement, forge text not null, epic integer not null, art text not null,
  nr integer, seit text, text text, zeit text not null, abgeholt text, quittiert text);""")
    con.execute("insert into handlungen (forge, epic, art, zeit) values (?, 40, 'einreihen', '2026-11-20T14:30:00+00:00')", (PROBE,))
    con.commit()
    con.close()
    c = TestClient(erzeuge(Einstellung(db=str(db), pin='4711', uhr=uhr)))
    assert c.get('/api/tafel').json()['prototypen'] == []
    mit_beispiel(c, satz)
    assert len(c.get('/api/tafel').json()['prototypen']) == 3
    assert [h['epic'] for h in c.get('/api/handlungen', params={'forge': PROBE}).json()] == [40]
    # and after a restart
    c = TestClient(erzeuge(Einstellung(db=str(db), pin='4711', uhr=uhr)))
    assert c.get('/holodeck/interias/sternwarte/sternkarte.html').status_code == 200
