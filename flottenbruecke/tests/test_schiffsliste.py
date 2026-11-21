"""Schiffsliste (#41): the sessions of the driver in the report and on the board (no path ever), and the
side bar's files. The bar itself is read only."""

import copy
import json
import re
from datetime import timedelta
from pathlib import Path

STATIC = Path(__file__).parent.parent / 'app' / 'static'
# invented patterns, never a real path
WIN = 'C:\\Users\\beispiel\\git\\flotte-probe'
UNIX = '/home/beispiel/git/notizen'


def sitzung(**o):
    return {'konto': 'Konto 1', 'projekt': 'flotte-probe', 'name': 'flotte-probe-ab', 'status': 'busy', 'kind': 'interactive', 'seit': '2026-11-20T12:02:00Z', **o}


def melde(c, b):
    r = c.post('/api/bericht', json=b)
    assert r.status_code == 200, r.text
    return r


def tafel(c):
    return c.get('/api/tafel').json()


# ---- the report and the board

def test_sitzungen_kommen_mit_ihrem_projekt_auf_die_tafel(client, bericht):
    bericht['sitzungen'] = [sitzung(), sitzung(konto='Konto 2', projekt='notizen', name='notizen-cd', status='idle')]
    melde(client, bericht)
    s = tafel(client)['sitzungen']
    assert [(x['konto'], x['forge'], x['status']) for x in s] == [('Konto 1', 'interias/flotte-probe', 'busy'), ('Konto 2', None, 'idle')]
    assert set(s[0]) == {'konto', 'projekt', 'name', 'status', 'kind', 'seit', 'forge'}


def test_beispiel_traegt_sitzungen_und_ein_aelterer_treiber_bleibt_gueltig(client, bericht):
    assert bericht['sitzungen']
    melde(client, bericht)
    assert len(tafel(client)['sitzungen']) == len(bericht['sitzungen'])
    del bericht['sitzungen']
    melde(client, bericht)
    assert tafel(client)['sitzungen'] == []


def test_kein_pfad_erreicht_die_tafel_auch_wenn_ein_treiber_ihn_schickt(client, bericht):
    bericht['sitzungen'] = [sitzung(cwd=WIN, pid=4242, sessionId='abc-123'), sitzung(konto='Konto 2', projekt='notizen', name='notizen-cd', cwd=UNIX)]
    melde(client, bericht)
    text = client.get('/api/tafel').text
    for verboten in ('beispiel\\\\', 'Users', '/home/', '4242', 'abc-123', 'cwd', 'sessionId'):
        assert verboten not in text
    # and not in the store either
    gespeichert = json.dumps(client.get('/api/tafel').json()['sitzungen'])
    assert 'cwd' not in gespeichert and 'pid' not in gespeichert


def test_ein_pfad_als_projekt_wird_abgelehnt(client, bericht):
    for pfad in (WIN, UNIX):
        bericht['sitzungen'] = [sitzung(projekt=pfad)]
        assert client.post('/api/bericht', json=bericht).status_code == 422


def test_dieselbe_sitzung_aus_zwei_berichten_zaehlt_einmal_und_der_neuere_gilt(client, bericht, uhr):
    zweit = copy.deepcopy(bericht)
    zweit['forge'] = 'interias/notizen'
    bericht['sitzungen'] = [sitzung()]
    zweit['sitzungen'] = [sitzung(status='idle'), sitzung(konto='Konto 2', projekt='notizen', name='notizen-cd')]
    melde(client, bericht)
    uhr.t += timedelta(seconds=10)
    melde(client, zweit)
    s = tafel(client)['sitzungen']
    assert [(x['konto'], x['status'], x['forge']) for x in s] == [('Konto 1', 'idle', 'interias/flotte-probe'), ('Konto 2', 'busy', 'interias/notizen')]


def test_der_neuere_bericht_gilt_auch_wenn_sein_projekt_alphabetisch_vorn_steht(client, bericht, uhr):
    spaet = copy.deepcopy(bericht)
    spaet['forge'] = 'interias/aaa'
    bericht['forge'] = 'interias/zzz'
    bericht['sitzungen'] = [sitzung(status='busy')]
    spaet['sitzungen'] = [sitzung(status='idle')]
    melde(client, bericht)
    uhr.t += timedelta(seconds=10)
    melde(client, spaet)
    assert [x['status'] for x in tafel(client)['sitzungen']] == ['idle']


def test_sitzungen_eines_stillen_projekts_verschwinden(client, bericht, uhr):
    bericht['sitzungen'] = [sitzung()]
    melde(client, bericht)
    uhr.t += timedelta(minutes=4)
    assert tafel(client)['sitzungen'] == []


# ---- the side bar's files

def test_schiffsliste_wird_mit_inhaltsstand_nach_der_huelle_und_vor_dem_board_geladen(client):
    html = client.get('/').text
    stand = re.search(r'/static/app\.js\?v=([0-9a-f]{12})"', html).group(1)
    for n in ('schiffsliste.css', 'schiffsliste.js'):
        assert f'/static/{n}?v={stand}"' in html
        assert client.get(f'/static/{n}?v={stand}').status_code == 200
    assert html.index('/static/huelle.js?v=') < html.index('/static/schiffsliste.js?v=') < html.index('/static/app.js?v=')
    assert '<aside class="seite" id="seite" aria-label="Schiffsliste">' in html
    # a button in the bar for the phone's drawer and one for folding
    assert 'id="seite-auf"' in html and 'id="seite-zu"' in html


def test_huelle_bietet_springen_und_tafel_lauschen(client):
    js = (STATIC / 'huelle.js').read_text(encoding='utf-8')
    assert 'return { bereich, tafel, springe, beiTafel };' in js


def test_schiffsliste_ist_nur_lesend_und_ohne_blinken():
    js = (STATIC / 'schiffsliste.js').read_text(encoding='utf-8')
    css = (STATIC / 'schiffsliste.css').read_text(encoding='utf-8')
    # no request at all, no write to the driver or to a session
    assert not re.search(r'fetch\(|XMLHttpRequest|sendBeacon|method:', js)
    # no blinking, no red, no motion beyond the drawer's slide (switched off for reduced motion)
    assert '@keyframes' not in css and 'animation' not in css and 'var(--rot)' not in css
    assert 'prefers-reduced-motion' in css
    # every colour of the table has a dot
    for farbe in ('blau', 'lila', 'gruen', 'gelb', 'grau'):
        assert f'.punkt.{farbe}' in css
        assert re.search(rf'\b{farbe}:\s*\{{ text:', js)


def test_schublade_hat_feste_hoehe_damit_eine_lange_liste_scrollt():
    css = (STATIC / 'schiffsliste.css').read_text(encoding='utf-8')
    telefon = css[css.index('@media (max-width: 700px)'):]
    # top and bottom fix the height only with align-self: stretch (the bar's `start` lets it grow past the screen)
    assert 'align-self: stretch' in telefon[telefon.index('.seite {'):telefon.index('.seite.auf')]


def test_keine_lokalen_pfade_in_den_dateien_der_schiffsliste():
    for n in ('schiffsliste.js', 'schiffsliste.css', 'index.html'):
        text = (STATIC / n).read_text(encoding='utf-8')
        assert not re.search(r'[A-Za-z]:\\\\Users|/home/\w|/Users/\w', text)
