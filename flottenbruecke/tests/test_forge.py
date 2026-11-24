"""#125: the forge per project in the Maschinenraum: the state the driver reports (never a token), the action
forge_verknuepfen only with a paired device, and the step "Forge verknüpfen" of the guided start."""

import copy

from conftest import fremd, koppeln

FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}


def mit_forge(bericht, **status):
    b = copy.deepcopy(bericht)
    b['forgeStatus'] = {'art': 'github', 'forge': FORGE, 'angemeldet': True, 'konto': 'octo', 'rechte': 'ok', 'treiber': True, **status}
    return b


def verknuepfen(c, pin='4711'):
    return c.post('/api/handlung', json={'forge': FORGE, 'epic': 0, 'art': 'forge_verknuepfen'}, headers={'X-Bruecke-Pin': pin} if pin else {})


def schritt(c):
    return next(s['stand'] for s in c.get('/api/tafel').json()['einrichten']['schritte'] if s['schritt'] == 'forge')


def test_status_je_projekt_ohne_token(client, bericht, tmp_path):
    b = mit_forge(bericht)
    b['forgeStatus']['token'] = 'gho_geheim'
    assert client.post('/api/bericht', json=b).status_code == 200
    p = client.get('/api/tafel').json()['projekte'][0]
    assert p['forgeStatus'] == {'art': 'github', 'forge': FORGE, 'angemeldet': True, 'konto': 'octo', 'rechte': 'ok', 'treiber': True}
    assert 'gho_geheim' not in client.get('/api/tafel').text
    assert b'gho_geheim' not in (tmp_path / 'b.db').read_bytes()
    assert schritt(client) == 'fertig'


def test_handlung_nur_mit_geraet_mit_recht(client, bericht):
    client.post('/api/bericht', json=mit_forge(bericht, angemeldet=False, konto=None, rechte=None))
    assert schritt(client) == 'offen'
    assert verknuepfen(fremd(client)).status_code == 401
    stumm = fremd(client)
    koppeln(stumm, handeln=False)
    assert verknuepfen(stumm).status_code == 403
    assert verknuepfen(client, pin=None).json()['ok']
    assert schritt(client) == 'wartet'
    geholt = client.get('/api/handlungen', params={'forge': FORGE}).json()
    assert [(h['epic'], h['art'], h['text']) for h in geholt] == [(0, 'forge_verknuepfen', None)]


def test_fehlende_rechte_sind_nicht_fertig_und_aelterer_treiber_ohne_status(client, bericht):
    client.post('/api/bericht', json=mit_forge(bericht, rechte='fehlt'))
    assert schritt(client) == 'offen'
    ohne = {k: v for k, v in bericht.items() if k != 'forgeStatus'}
    ohne['forge'] = 'interias/anderes'
    client.post('/api/bericht', json=ohne)
    # the older driver works with its forge: the step counts as done
    assert schritt(client) == 'fertig'
    assert client.post('/api/handlung', json={'forge': 'interias/anderes', 'epic': 0, 'art': 'forge_verknuepfen'}, headers=PIN).status_code == 409
