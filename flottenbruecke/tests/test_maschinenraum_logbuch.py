import re


def tafel(c):
    return c.get('/api/tafel').json()


def test_bereichsdateien_werden_ausgeliefert(client):
    html = client.get('/').text
    for n in ('maschinenraum', 'logbuch'):
        assert re.search(rf'/static/bereiche/{n}\.js\?v=[0-9a-f]{{12}}"', html)
        assert re.search(rf'/static/bereiche/{n}\.css\?v=[0-9a-f]{{12}}"', html)
        assert f'data-bereich="{n}"' in html
        assert client.get(f'/static/bereiche/{n}.js').status_code == 200
    assert 'href="#logbuch"' in html.split('class="fuss"')[1]


def test_maschinenraum_liest_diese_felder_aus_dem_beispielbericht(client, bericht):
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    assert {'konto', 'stufe', 'fuenf', 'woche', 'alterMin', 'veraltet'} <= set(t['konten'][0])
    assert {'verbraucht', 'reset'} <= set(t['konten'][0]['fuenf'])
    r = t['rechner'][0]
    assert r['ram']['prozent'] == 61.4 and r['platte']['genug'] is True and r['obergrenze'] == 3
    p = t['projekte'][0]
    assert p['taktS'] == 60 and p['rechner'] == r['name'] and p['empfangen'] and p['veraltet'] is False


def test_maschinenraum_ohne_felder_baut_die_tafel_weiter(client, bericht):
    bericht['konten'] = []
    bericht['ram'] = None
    bericht['platte'] = None
    del bericht['obergrenze']
    assert client.post('/api/bericht', json=bericht).status_code == 200
    t = tafel(client)
    assert t['konten'] == []
    assert (t['rechner'][0]['ram'], t['rechner'][0]['platte'], t['rechner'][0]['obergrenze']) == (None, None, None)


def test_logbuch_liest_ereignisse_und_entscheidungen(client, bericht):
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    assert {'zeit', 'forge', 'kurz', 'epic', 'text'} <= set(t['ereignisse'][0])
    assert t['projekte'][0]['url'] and t['projekte'][0]['forge'] == t['ereignisse'][0]['forge']
    d = next(x for x in t['erledigt'] if x['art'] == 'admiral')
    assert {'zeit', 'forge', 'repo', 'epic', 'nr', 'antwort', 'herkunft', 'frage', 'widerrufen'} <= set(d)


def test_logbuch_ohne_ereignisse_und_entscheidungen(client, bericht):
    bericht['ereignisse'] = []
    bericht['entscheidungen'] = []
    assert client.post('/api/bericht', json=bericht).status_code == 200
    t = tafel(client)
    assert t['ereignisse'] == [] and not [x for x in t['erledigt'] if x['art'] == 'admiral']
