"""The gate runs of the driver (duration, contexts, cache hits): per mission the last one, per project the last ones."""


def tafel(c):
    return c.get('/api/tafel').json()


def test_je_mission_die_letzte_andockpruefung_mit_cache_anteil(client, bericht):
    assert client.post('/api/bericht', json=bericht).status_code == 200
    t = tafel(client)
    s37 = next(k for k in t['unterwegs']['schlange'] if k['nr'] == 37)
    a = s37['andockpruefung']
    assert (a['dauerS'], a['gruen'], a['pr'], a['ausCache'], a['mitCache']) == (14, True, 45, 2, 3)
    assert [k['name'] for k in a['kontexte']] == ['web', 'api', 'docs']
    # the blocked mission keeps its red run, the cache counts green and red contexts, never the skipped ones
    b40 = next(k for k in t['braucht'] if k.get('art') == 'blockade' and k['epic'] == 40)
    assert (b40['andockpruefung']['gruen'], b40['andockpruefung']['ausCache'], b40['andockpruefung']['mitCache']) == (False, 1, 2)
    # a mission without a gate run of the driver has none
    assert next(k for k in t['unterwegs']['schlange'] if k['nr'] == 36)['andockpruefung'] is None


def test_je_projekt_die_letzten_andockpruefungen_neueste_zuerst(client, bericht):
    client.post('/api/bericht', json=bericht)
    p = tafel(client)['projekte'][0]
    assert [(m['epic'], m['dauerS'], m['ausCache'], m['mitCache']) for m in p['andockpruefungen']] == [(37, 14, 2, 3), (40, 1355, 1, 2), (35, 3012, 0, 2)]


def test_ohne_gate_cached_keine_cache_angabe_die_dauer_bleibt(client, bericht):
    for m in [*bericht['andockpruefungen'], *(e['andockpruefung'] for e in bericht['epics'] if e['andockpruefung'])]:
        for k in m['kontexte']:
            k['cache'] = None
    client.post('/api/bericht', json=bericht)
    p = tafel(client)['projekte'][0]
    assert [(m['dauerS'], m['ausCache'], m['mitCache']) for m in p['andockpruefungen']] == [(14, None, None), (1355, None, None), (3012, None, None)]


def test_aelterer_treiber_ohne_messung_bleibt_gueltig(client, bericht):
    del bericht['andockpruefungen']
    for e in bericht['epics']:
        e.pop('andockpruefung', None)
    assert client.post('/api/bericht', json=bericht).status_code == 200
    t = tafel(client)
    assert t['projekte'][0]['andockpruefungen'] == []
    assert all(k['andockpruefung'] is None for k in t['unterwegs']['schlange'])


def test_lange_messung_wird_gekuerzt_nicht_abgelehnt(client, bericht):
    # review M3: a long gate block never costs the whole report
    m = bericht['andockpruefungen'][0]
    m['kontexte'] = [{'name': 'k' * 300, 'ergebnis': 'e' * 90, 'dauerS': 1, 'cache': None} for _ in range(60)]
    m['zeit'] = m['zeit'] + 'x' * 80
    bericht['andockpruefungen'] = bericht['andockpruefungen'] * 30
    assert client.post('/api/bericht', json=bericht).status_code == 200
    p = tafel(client)['projekte'][0]
    assert len(p['andockpruefungen']) == 50
    k = next(x for x in p['andockpruefungen'] if len(x['kontexte']) == 40)['kontexte'][0]
    assert (len(k['name']), len(k['ergebnis'])) == (100, 40)


def test_unerwarteter_wert_kostet_nur_die_messung(client, bericht):
    bericht['andockpruefungen'][0]['dauerS'] = -1
    e = next(e for e in bericht['epics'] if e['nr'] == 37)
    e['andockpruefung']['gruen'] = 'vielleicht'
    assert client.post('/api/bericht', json=bericht).status_code == 200
    t = tafel(client)
    assert len(t['projekte'][0]['andockpruefungen']) == 2
    assert next(k for k in t['unterwegs']['schlange'] if k['nr'] == 37)['andockpruefung'] is None


def test_oberflaeche_zeigt_die_messung(client):
    app = client.get('/static/app.js').text
    mr = client.get('/static/bereiche/maschinenraum.js').text
    assert 'function andockHtml(' in app and 'aus dem Cache' in app
    assert 'Letzte Andockprüfungen' in mr and 'aus dem Cache' in mr
