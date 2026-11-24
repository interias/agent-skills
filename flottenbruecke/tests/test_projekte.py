"""#126: projekt_hinzufuegen and projekt_entfernen, only with a paired device and only for a project whose driver fetches them.
Entfernen takes the project from the list with a mark (nothing deleted); a newly started driver of it brings it back."""

import copy
import json

from conftest import fremd, koppeln

FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}


def mit_projekten(bericht, gestartet='2026-11-20T08:00:00Z'):
    b = copy.deepcopy(bericht)
    b['projektHandlungen'] = True
    b['version']['gestartet'] = gestartet
    return b


def handlung(c, art, text=None, forge=FORGE, pin='4711'):
    return c.post('/api/handlung', json={'forge': forge, 'epic': 0, 'art': art, 'text': text}, headers={'X-Bruecke-Pin': pin} if pin else {})


def hinzufuegen(c, ordner='C:\\repos\\neues-projekt', autostart=True, **o):
    return handlung(c, 'projekt_hinzufuegen', json.dumps({'ordner': ordner, 'autostart': autostart}), **o)


def forges(c):
    return [p['forge'] for p in c.get('/api/tafel').json()['projekte']]


def schritt(c):
    return next(s['stand'] for s in c.get('/api/tafel').json()['einrichten']['schritte'] if s['schritt'] == 'projekt')


def test_hinzufuegen_nur_mit_geraet_fuer_einen_treiber_der_es_abholt(client, bericht):
    client.post('/api/bericht', json=mit_projekten(bericht))
    assert hinzufuegen(fremd(client)).status_code == 401
    stumm = fremd(client)
    koppeln(stumm, handeln=False)
    assert hinzufuegen(stumm).status_code == 403
    assert hinzufuegen(client, forge='interias/unbekannt').status_code == 404
    r = hinzufuegen(client)
    assert r.json()['ok']
    assert schritt(client) == 'wartet'
    p = client.get('/api/tafel').json()['projekte'][0]
    assert p['meldetProjekte'] is True
    assert p['hinzufuegen']['abgeholt'] is False
    geholt = client.get('/api/handlungen', params={'forge': FORGE}).json()
    assert [(h['epic'], h['art'], json.loads(h['text'])) for h in geholt] == [(0, 'projekt_hinzufuegen', {'ordner': 'C:\\repos\\neues-projekt', 'autostart': True})]


def test_hinzufuegen_abgelehnt_ohne_ordner_zu_lang_oder_aelterer_treiber(client, bericht):
    client.post('/api/bericht', json=mit_projekten(bericht))
    assert hinzufuegen(client, ordner='  ').status_code == 422
    assert hinzufuegen(client, ordner='C:\\' + 'x' * 300).status_code == 422
    assert handlung(client, 'projekt_hinzufuegen', '{"ordner": "C:\\\\r", "autostart": "ja"}').status_code == 422
    assert handlung(client, 'projekt_hinzufuegen', 'kein json').status_code == 422
    # only an absolute folder; surrounding quotes ("Copy as path") are cut off
    assert hinzufuegen(client, ordner='repos\\relativ').status_code == 422
    assert hinzufuegen(client, ordner='"C:\\repos\\in anfuehrung"').json()['ok']
    geholt = client.get('/api/handlungen', params={'forge': FORGE}).json()
    assert json.loads(geholt[-1]['text'])['ordner'] == 'C:\\repos\\in anfuehrung'
    alt = copy.deepcopy(bericht)
    alt['forge'] = 'interias/alt'
    del alt['projektHandlungen']
    client.post('/api/bericht', json=alt)
    assert hinzufuegen(client, forge='interias/alt').status_code == 409
    assert handlung(client, 'projekt_entfernen', forge='interias/alt').status_code == 409


def test_entfernen_nimmt_das_projekt_aus_der_liste_und_loescht_nichts(client, bericht, tmp_path):
    client.post('/api/bericht', json=mit_projekten(bericht))
    assert handlung(fremd(client), 'projekt_entfernen').status_code == 401
    assert handlung(client, 'projekt_entfernen').json()['ok']
    assert FORGE not in forges(client)
    # the driver still fetches it and halts; its last reports (same start) keep the project out of the list
    assert [h['art'] for h in client.get('/api/handlungen', params={'forge': FORGE}).json()] == ['projekt_entfernen']
    client.post('/api/bericht', json=mit_projekten(bericht))
    assert FORGE not in forges(client)
    assert handlung(client, 'projekt_entfernen').status_code == 409
    # nothing deleted: the row of the project and its report stay in the database
    assert FORGE.encode() in (tmp_path / 'b.db').read_bytes()


def test_ein_neu_gestarteter_treiber_bringt_das_projekt_zurueck(client, bericht):
    client.post('/api/bericht', json=mit_projekten(bericht))
    handlung(client, 'projekt_entfernen')
    client.post('/api/bericht', json=mit_projekten(bericht, gestartet='2026-11-21T09:00:00Z'))
    assert FORGE in forges(client)
    # the removal the old driver never fetched does not halt the new one
    assert client.get('/api/handlungen', params={'forge': FORGE}).json() == []


# ---- adding a project by a link to its repository: the driver clones at its machine, the bridge checks the link


def mit_klonen(bericht, gitea=None, luecken=None):
    b = mit_projekten(bericht)
    b['klonAngebot'] = {'gitea': gitea or [], 'eltern': 'C:\\Users\\jemand\\git'}
    if luecken is not None:
        b['adapterLuecken'] = luecken
    return b


def klonen(c, url, ordner=None, **o):
    d = {'url': url, 'autostart': False}
    if ordner is not None:
        d['ordner'] = ordner
    return handlung(c, 'projekt_hinzufuegen', json.dumps(d), **o)


def test_link_mit_und_ohne_ordner_geht_an_den_treiber(client, bericht):
    client.post('/api/bericht', json=mit_klonen(bericht))
    assert klonen(client, ' https://github.com/octo/klein ').json()['ok']
    nur_link = client.get('/api/handlungen', params={'forge': FORGE}).json()[-1]
    assert json.loads(nur_link['text']) == {'url': 'https://github.com/octo/klein', 'autostart': False}
    # once acknowledged, "Erledigt" names the repository of the link, never a path
    assert client.post(f"/api/handlungen/{nur_link['id']}/quittung").json()['ok']
    eintrag = next(x for x in client.get('/api/tafel').json()['erledigt'] if x.get('handlung') == 'projekt_hinzufuegen')
    assert (eintrag['ordner'], eintrag['link'], eintrag['text']) == (None, 'octo/klein', None)
    assert klonen(client, 'https://github.com/octo/klein.git', ordner='D:\\repos\\klein').json()['ok']
    assert json.loads(client.get('/api/handlungen', params={'forge': FORGE}).json()[-1]['text']) == {'ordner': 'D:\\repos\\klein', 'url': 'https://github.com/octo/klein.git', 'autostart': False}


def test_link_nur_https_auf_github_oder_der_gemeldeten_gitea_forge(client, bericht):
    client.post('/api/bericht', json=mit_klonen(bericht, gitea=['https://gitea.beispiel.de:3000']))
    for url, text in [
        ('http://github.com/octo/klein', 'Nur https-Links'),
        ('file:///C:/geheim', 'Nur https-Links'),
        ('ssh://git@github.com/octo/klein', 'Nur https-Links'),
        ('git@github.com:octo/klein.git', 'Nur https-Links'),
        ('https://user:geheim@github.com/octo/klein', 'Benutzerangaben'),
        ('https://localhost/octo/klein', 'eigenen Netzes'),
        ('https://192.168.1.20/octo/klein', 'eigenen Netzes'),
        ('https://github.com/octo', 'kein Repository'),
        ('https://github.com/octo/klein?x=1', 'Parameter'),
        ('https://gitlab.com/octo/klein', 'keine erlaubte Quelle'),
        ('https://gitea.beispiel.de/team/werk', 'keine erlaubte Quelle'),
    ]:
        r = klonen(client, url)
        assert r.status_code == 422, url
        assert text in r.text, (url, r.text)
    assert klonen(client, 'https://gitea.beispiel.de:3000/team/werk').json()['ok']
    # neither folder nor link; a folder that is not absolute next to a link
    assert handlung(client, 'projekt_hinzufuegen', '{"autostart": false}').status_code == 422
    assert klonen(client, 'https://github.com/octo/klein', ordner='relativ').status_code == 422


def test_link_bei_einem_treiber_ohne_klonen_abgelehnt(client, bericht):
    client.post('/api/bericht', json=mit_projekten(bericht))
    r = klonen(client, 'https://github.com/octo/klein')
    assert r.status_code == 409
    assert 'Link' in r.json()['detail']
    # the folder alone still goes
    assert hinzufuegen(client).json()['ok']


def test_tafel_traegt_klonangebot_und_adapterluecken(client, bericht):
    client.post('/api/bericht', json=mit_klonen(bericht, luecken=['gate_command', 'test_commands']))
    p = client.get('/api/tafel').json()['projekte'][0]
    assert p['klonAngebot'] == {'gitea': [], 'eltern': 'C:\\Users\\jemand\\git'}
    assert p['adapterLuecken'] == ['gate_command', 'test_commands']
    client.post('/api/bericht', json=mit_projekten(bericht))
    p = client.get('/api/tafel').json()['projekte'][0]
    assert p['klonAngebot'] is None
    assert p['adapterLuecken'] == []
