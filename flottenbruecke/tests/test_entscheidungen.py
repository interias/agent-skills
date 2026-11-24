"""Decisions of an epic until the merge (#52): each epic not merged carries the person's answers and the
influential decisions of the admiral and the run, from any day, revocable with the PIN until the merge."""

FORGE = 'interias/flotte-probe'
GESTERN = {'epic': 38, 'nr': 2, 'seit': '2026-11-19T16:40:00Z'}
MENSCH = {'epic': 38, 'nr': 3, 'seit': '2026-11-19T17:05:12Z'}


def tafel(c):
    return c.get('/api/tafel').json()


def laeufe(c):
    return {e['nr']: e for e in tafel(c)['unterwegs']['laeufe']}


def von_epic(c, nr):
    return [(d['nr'], d['von']) for d in laeufe(c)[nr]['entscheidungen']]


def widerruf(c, text='Doch eine Liste ohne Gruppen', pin='4711', **bezug):
    return c.post('/api/handlung', json={'forge': FORGE, 'art': 'widerruf', 'text': text, **bezug}, headers={'X-Bruecke-Pin': pin})


def test_entscheidung_von_gestern_bei_laufendem_epic_sichtbar_und_widerrufbar(client, bericht):
    client.post('/api/bericht', json=bericht)
    # newest first: the run's from today, the person's and the admiral's from yesterday
    assert von_epic(client, 38) == [(1, 'lauf'), (3, 'mensch'), (2, 'admiral')]
    d = laeufe(client)[38]['entscheidungen'][2]
    assert (d['frage'], d['herkunft'], d['seit'], d['widerrufbar'], d['handlung']) == ('Die Einträge im Changelog nach Paketen gruppieren?', 'Eigenes Urteil: liest sich leichter', GESTERN['seit'], True, None)
    assert d['zeit'].startswith('2026-11-19T16:40')
    # yesterday's is not on "Erledigt heute"
    assert not [x for x in tafel(client)['erledigt'] if x['art'] == 'admiral' and x['nr'] == 2 and x['epic'] == 38]
    assert widerruf(client, pin='0000', **GESTERN).status_code == 403
    assert widerruf(client, **GESTERN).status_code == 200
    assert laeufe(client)[38]['entscheidungen'][2]['handlung']['text'] == 'Doch eine Liste ohne Gruppen'
    assert [(h['art'], h['epic'], h['nr'], h['seit']) for h in client.get('/api/handlungen', params={'forge': FORGE}).json()] == [('widerruf', 38, 2, GESTERN['seit'])]


def test_antwort_des_menschen_ist_zuruecknehmbar(client, bericht):
    client.post('/api/bericht', json=bericht)
    d = next(x for x in laeufe(client)[38]['entscheidungen'] if x['von'] == 'mensch')
    assert (d['nr'], d['antwort'], d['herkunft'], d['einflussreich'], d['widerrufbar']) == (3, 'A — nur erfundene Namen', 'Mensch über die Brücke', False, True)
    assert widerruf(client, text='B', **MENSCH).status_code == 200
    # the driver took it over: the report says widerrufen, and a second time is refused
    for x in bericht['entscheidungen']:
        if (x['epic'], x['nr']) == (38, 3):
            x['widerrufen'] = 'B'
    client.post('/api/bericht', json=bericht)
    d = next(x for x in laeufe(client)[38]['entscheidungen'] if x['von'] == 'mensch')
    assert (d['widerrufen'], d['widerrufbar']) == ('B', False)
    assert widerruf(client, text='C', **MENSCH).status_code == 409


def test_nach_dem_merge_nicht_mehr_sichtbar_und_nicht_widerrufbar(client, bericht):
    client.post('/api/bericht', json=bericht)
    # epic 35 is merged in the example: its decision of yesterday is nowhere, a revocation is 409
    assert all(d['epic'] != 35 for e in laeufe(client).values() for d in e['entscheidungen'])
    assert widerruf(client, epic=35, nr=1, seit='2026-11-19T11:20:00Z').status_code == 409
    bericht['epics'][1]['stufe'] = 'fertig'
    client.post('/api/bericht', json=bericht)
    assert 38 not in laeufe(client)
    gemergt = next(x for x in tafel(client)['erledigt'] if x['art'] == 'gemergt' and x['epic'] == 38)
    assert gemergt['entscheidungen'] == []
    assert widerruf(client, **GESTERN).status_code == 409
    assert widerruf(client, **MENSCH).status_code == 409


def test_nur_die_kritischsten(client, bericht):
    # the admiral's 39/2 is not influential: it stays in the logbook and at the issue
    client.post('/api/bericht', json=bericht)
    assert von_epic(client, 39) == []
    # the run's without einflussreich is left out too, the person's always shown
    for x in bericht['entscheidungen']:
        if (x['epic'], x['nr']) == (38, 1):
            x['einflussreich'] = False
    client.post('/api/bericht', json=bericht)
    assert von_epic(client, 38) == [(3, 'mensch'), (2, 'admiral')]


def test_jede_offene_karte_traegt_ihre_entscheidungen(client, bericht):
    for x in bericht['entscheidungen']:
        if (x['epic'], x['nr']) == (38, 2):
            x['epic'] = 36
        if (x['epic'], x['nr']) == (38, 3):
            x['epic'] = 41
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    schlange = next(x for x in t['unterwegs']['schlange'] if x['nr'] == 36)
    bereit = next(x for x in t['unterwegs']['bereit'] if x['nr'] == 41)
    assert [d['nr'] for d in schlange['entscheidungen']] == [2]
    assert [d['von'] for d in bereit['entscheidungen']] == ['mensch']


def test_antwort_des_menschen_steht_nicht_als_admiral_in_erledigt(client, bericht):
    for x in bericht['entscheidungen']:
        if (x['epic'], x['nr']) == (38, 3):
            x['zeit'] = '2026-11-20T14:00:00Z'
    client.post('/api/bericht', json=bericht)
    assert [(x['epic'], x['nr']) for x in tafel(client)['erledigt'] if x['art'] == 'admiral'] == [(38, 1), (39, 2)]
    assert (3, 'mensch') in von_epic(client, 38)


def test_bericht_ohne_von_bleibt_gueltig(client, bericht):
    # an older driver: no von, the board reads the person from herkunft; an unknown word is no 422
    for x in bericht['entscheidungen']:
        del x['von']
    bericht['entscheidungen'][0]['von'] = 'flotte-v9'
    assert client.post('/api/bericht', json=bericht).status_code == 200
    assert von_epic(client, 38) == [(1, 'admiral'), (3, 'mensch'), (2, 'admiral')]
