"""#243 "Braucht dich" made clear: one card per cause with its three lines (what, who, the step), the missions it holds;
the question with its short line; "Dein Schritt bald" from a decision of the admiral; what the fleet repairs itself as a
line under "Unterwegs". "Erledigt" points at its cause or step and goes to the driver like every other action."""

FORGE = 'interias/flotte-probe'


def tafel(c):
    return c.get('/api/tafel').json()


def erledigt(c, epic, text):
    return c.post('/api/handlung', json={'forge': FORGE, 'epic': epic, 'art': 'erledigt', 'nr': None, 'seit': None, 'text': text}, headers={'X-Bruecke-Pin': '4711'})


def test_karten_je_ursache_frage_bald_und_unterwegs(client, bericht):
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    karten = {(x['art'], x['epic']): x for x in t['braucht']}
    assert list(karten) == [('blockade', 40), ('ursache', 37), ('frage', 39)]
    # the halted mission: its cause and the button the step names
    b = karten[('blockade', 40)]
    assert (b['ursache']['art'], b['ursache']['wer'], b['ursache']['knopf']) == ('gate_rot', 'mission', 'einreihen')
    assert [m['nr'] for m in b['missionen']] == [40]
    # the red base: a card of its own for the mission waiting in the queue, "Erledigt" the button
    r = karten[('ursache', 37)]
    assert r['id'] == f'ursache:{FORGE}#main_rot:api'
    assert (r['ursache']['kurz'], r['ursache']['knopf'], r['seit']) == ('main ist rot: tests/routen.test.ts scheitert in api.', 'erledigt', '2026-11-20T14:22:00+00:00')
    assert r['missionen'] == [{'nr': 37, 'titel': 'Mini-Mission: Versionsdatei', 'pr': 45, 'prUrl': f'https://github.com/{FORGE}/pull/45', 'issueUrl': f'https://github.com/{FORGE}/issues/37'}]
    assert r['erledigt'] is None
    # it still stands in the queue, its line says why it waits
    assert next(x for x in t['unterwegs']['schlange'] if x['nr'] == 37)['lage']['etikett'] == 'wartet_auf_dich'
    assert karten[('frage', 39)]['kurz'] == 'Wo soll die Konfigurationsdatei liegen?'
    # what the fleet repairs itself: a line, no card
    assert [(s['epic'], s['kurz']) for s in t['unterwegs']['selbst']] == [(38, 'Konflikt mit main, die Flotte holt main selbst nach.')]
    assert [(s['epic'], s['schluessel'], s['kurz']) for s in t['bald']] == [(39, 'bald:39-1763647200000-0', '#41 dockt erst an, wenn config/flotte.json auf main liegt.')]


def test_eine_karte_fuer_alle_missionen_einer_ursache(client, bericht):
    rot = next(e for e in bericht['epics'] if e['nr'] == 37)['ursache']
    next(e for e in bericht['epics'] if e['nr'] == 36)['ursache'] = rot
    client.post('/api/bericht', json=bericht)
    karten = [x for x in tafel(client)['braucht'] if x['art'] == 'ursache']
    assert len(karten) == 1
    assert [m['nr'] for m in karten[0]['missionen']] == [36, 37]


def test_erledigt_zeigt_auf_seine_ursache_oder_seinen_schritt(client, bericht):
    client.post('/api/bericht', json=bericht)
    # the cause the mission carries now, or a step of the admiral's still in the report
    assert erledigt(client, 37, 'main_rot:api').json()['ok']
    assert erledigt(client, 39, 'bald:39-1763647200000-0').json()['ok']
    t = tafel(client)
    assert next(x for x in t['braucht'] if x['art'] == 'ursache')['erledigt'] is not None
    assert t['bald'][0]['erledigt'] is not None
    # both on their way: one action per target, not one per mission
    offen = client.get('/api/handlungen', params={'forge': FORGE}).json()
    assert [(h['epic'], h['art'], h['text']) for h in offen] == [(37, 'erledigt', 'main_rot:api'), (39, 'erledigt', 'bald:39-1763647200000-0')]
    # a cause gone, a step not reported, a mission the cause does not hold, no target: refused
    assert erledigt(client, 37, 'main_rot:web').status_code == 409
    assert erledigt(client, 36, 'main_rot:api').status_code == 409
    assert erledigt(client, 39, 'bald:weg').status_code == 404
    assert erledigt(client, 37, ' ').status_code == 422


def test_bericht_ohne_ursache_karten_wie_zuvor(client, bericht):
    for ep in bericht['epics']:
        ep.pop('ursache', None)
    del bericht['bald']
    client.post('/api/bericht', json=bericht)
    t = tafel(client)
    assert [(x['art'], x['epic']) for x in t['braucht']] == [('blockade', 40), ('frage', 39)]
    assert t['braucht'][0]['ursache'] is None and t['bald'] == [] and t['unterwegs']['selbst'] == []
