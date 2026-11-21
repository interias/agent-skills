"""Settings of the driver on the bridge (#59): accepted only with the PIN and within the limits of the report,
shown per project with the change on its way, an older driver without settings stays read only."""

import json

FORGE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}


def tafel(c):
    return c.get('/api/tafel').json()


def einstellen(c, name, wert, pin='4711'):
    body = {'forge': FORGE, 'epic': 0, 'art': 'einstellen', 'nr': None, 'seit': None, 'text': json.dumps({'name': name, 'wert': wert})}
    return c.post('/api/handlung', json=body, headers={'X-Bruecke-Pin': pin} if pin is not None else {})


def offene(c):
    return c.get('/api/handlungen', params={'forge': FORGE}).json()


def je_name(c):
    return {e['name']: e for e in tafel(c)['projekte'][0]['einstellungen']}


def test_annahme_abholen_quittieren(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert einstellen(client, 'obergrenze', 2).json()['ok']
    # shown as waiting for the driver, the report's own value stays the effective one
    e = je_name(client)['obergrenze']
    assert (e['wert'], e['herkunft'], e['offen']['wert'], e['offen']['abgeholt']) == (3, 'bruecke', 2, False)
    geholt = offene(client)
    assert [(h['epic'], h['art'], h['nr'], h['seit'], h['text'], h['herkunft']) for h in geholt] == [(0, 'einstellen', None, None, '{"name": "obergrenze", "wert": 2}', 'Mensch über die Brücke')]
    assert je_name(client)['obergrenze']['offen']['abgeholt'] is True
    # after the driver fetched it, a second change of the same setting is 409
    assert einstellen(client, 'obergrenze', 1).status_code == 409
    assert client.post(f"/api/handlungen/{geholt[0]['id']}/quittung").json() == {'ok': True}
    assert je_name(client)['obergrenze']['offen'] is None
    # the logbook gets it by the title of the setting, without an epic
    x = next(x for x in tafel(client)['erledigt'] if x['art'] == 'handlung')
    assert (x['epic'], x['handlung'], x['titel'], x['wert']) == (None, 'einstellen', 'Epics gleichzeitig', 2)


def test_letzte_aenderung_je_einstellung_gilt_bis_zum_abholen(client, bericht):
    client.post('/api/bericht', json=bericht)
    einstellen(client, 'obergrenze', 2)
    einstellen(client, 'platteMinGb', 50)
    einstellen(client, 'obergrenze', 4)
    assert [json.loads(h['text']) for h in offene(client)] == [{'name': 'obergrenze', 'wert': 4}, {'name': 'platteMinGb', 'wert': 50}]


def test_ohne_pin_oder_mit_falscher_pin_nichts(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert einstellen(client, 'obergrenze', 2, pin=None).status_code == 401
    assert einstellen(client, 'obergrenze', 2, pin='0000').status_code == 401
    assert offene(client) == []


def test_ohne_gesetzte_pin_ist_einstellen_abgeschaltet(bruecke, bericht):
    c = bruecke(pin='')
    c.post('/api/bericht', json=bericht)
    assert einstellen(c, 'obergrenze', 2).status_code == 403


def test_grenzen_der_zahlen(client, bericht):
    client.post('/api/bericht', json=bericht)
    for name, ok, schlecht in [('obergrenze', [1, 4], [0, 5]), ('paketeJeEpic', [1, 3], [0, 4]), ('verbrauchGelb', [1, 84], [0, 99]), ('verbrauchRot', [86, 99], [1, 100]),
                               ('ramWarn', [50, 84], [49, 85]), ('platteMinGb', [1, 1000], [0, 1001]), ('leerlaufMin', [5, 480], [4, 481])]:
        for w in ok:
            assert einstellen(client, name, w).status_code == 200, (name, w)
        for w in schlecht:
            assert einstellen(client, name, w).status_code == 422, (name, w)
    # whole numbers only, no text, no truth values
    for w in (2.5, '2', True, [2]):
        assert einstellen(client, 'obergrenze', w).status_code == 422, w


def test_null_nur_wo_der_treiber_es_erlaubt(client, bericht):
    client.post('/api/bericht', json=bericht)
    for name in ('obergrenze', 'ramWarn', 'admiral'):
        assert einstellen(client, name, None).status_code == 200, name
    for name in ('paketeJeEpic', 'konten', 'verbrauchRot', 'platteMinGb', 'leerlaufMin'):
        assert einstellen(client, name, None).status_code == 422, name


def test_konten_nur_aus_der_auswahl_und_mindestens_eines(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert einstellen(client, 'konten', ['Konto 1', 'Konto 3']).status_code == 200
    assert einstellen(client, 'konten', []).status_code == 422
    assert einstellen(client, 'konten', ['Konto 9']).status_code == 422
    assert einstellen(client, 'konten', ['Konto 1', 'Konto 1']).status_code == 422
    assert einstellen(client, 'konten', 'Konto 1').status_code == 422
    assert einstellen(client, 'leerfahren', []).status_code == 200
    assert einstellen(client, 'leerfahren', ['Konto 2']).status_code == 200
    assert einstellen(client, 'admiral', 'Konto 2').status_code == 200
    assert einstellen(client, 'admiral', 'Konto 9').status_code == 422
    assert einstellen(client, 'admiral', ['Konto 2']).status_code == 422


def test_gelb_bleibt_unter_rot_auch_mit_einer_wartenden_aenderung(client, bericht):
    client.post('/api/bericht', json=bericht)
    # reported: gelb 60, rot 85
    assert einstellen(client, 'verbrauchGelb', 85).status_code == 422
    assert einstellen(client, 'verbrauchRot', 60).status_code == 422
    assert einstellen(client, 'verbrauchGelb', 84).status_code == 200
    # gelb 84 is queued: rot 84 would break it, 90 does not, and then gelb 89 is fine
    assert einstellen(client, 'verbrauchRot', 84).status_code == 422
    assert einstellen(client, 'verbrauchRot', 90).status_code == 200
    assert einstellen(client, 'verbrauchGelb', 89).status_code == 200


def test_unbekannte_einstellung_und_unfertiger_body(client, bericht):
    client.post('/api/bericht', json=bericht)
    assert einstellen(client, 'merge', 1).status_code == 422
    for text in (None, 'kein json', '[1]', '{"name": "obergrenze"}', '{"wert": 2}'):
        body = {'forge': FORGE, 'epic': 0, 'art': 'einstellen', 'text': text}
        assert client.post('/api/handlung', json=body, headers=PIN).status_code == 422, text
    body = {'forge': FORGE, 'epic': 40, 'art': 'einstellen', 'text': '{"name": "obergrenze", "wert": 2}'}
    assert client.post('/api/handlung', json=body, headers=PIN).status_code == 422
    assert offene(client) == []


def test_alter_treiber_ohne_einstellungen(client, bericht):
    del bericht['einstellungen']
    assert client.post('/api/bericht', json=bericht).status_code == 200
    assert tafel(client)['projekte'][0]['einstellungen'] is None
    assert einstellen(client, 'obergrenze', 2).status_code == 409
    assert offene(client) == []


def test_unbekanntes_projekt_ist_409_nicht_500(client):
    assert einstellen(client, 'obergrenze', 2).status_code == 409


def test_bericht_mit_unbekannter_herkunft_wird_abgelehnt(client, bericht):
    bericht['einstellungen'][0]['herkunft'] = 'irgendwo'
    assert client.post('/api/bericht', json=bericht).status_code == 422


def test_einstellen_stoert_die_epic_handlungen_nicht(client, bericht):
    client.post('/api/bericht', json=bericht)
    einstellen(client, 'obergrenze', 2)
    assert client.post('/api/handlung', json={'forge': FORGE, 'epic': 40, 'art': 'einreihen'}, headers=PIN).status_code == 200
    assert client.post('/api/handlung', json={'forge': FORGE, 'epic': 0, 'art': 'einreihen'}, headers=PIN).status_code == 404
    assert sorted(h['art'] for h in offene(client)) == ['einreihen', 'einstellen']
