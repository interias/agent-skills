"""Detail view of an epic (#51): phase, round and class per package, the places and the restarts in the
epic head, the hint "longer than usual". The fields come from the driver; the bridge passes them on,
computes the hint itself and leaves out what an older report does not have."""

DETAIL = ('phase', 'runde', 'stufe', 'stufeStart', 'eskaliert', 'erstAufruf', 'phaseSeit', 'lebenszeichen')


def laeufe(c):
    return {e['nr']: e for e in c.get('/api/tafel').json()['unterwegs']['laeufe']}


def pakete(c, nr):
    return {p['nr'] or p['name']: p for p in laeufe(c)[nr]['pakete']}


def test_beispiel_zeigt_alle_phasen_und_eine_eskalation(client, bericht):
    client.post('/api/bericht', json=bericht)
    p = pakete(client, 38)
    assert {k: p[k]['phase'] for k in (47, 53, 54, 55)} == {47: 'nachbesserung', 53: 'implementer', 54: 'review', 55: 'merge'}
    assert (p[47]['runde'], p[47]['stufe'], p[47]['stufeStart'], p[47]['eskaliert']) == (3, 'urteil-hoch', 'standard', True)
    assert (p[55]['runde'], p[55]['stufe'], p[55]['stufeStart']) == (2, 'urteil', 'standard')
    assert p[47]['lebenszeichen'] == '2026-11-20T14:29:40Z' and p[47]['phaseSeit'] == '2026-11-20T14:12:00Z'
    # merged: round and class stay, no phase
    assert (p[46]['phase'], p[46]['runde']) == (None, 1)
    # no call, no detail
    assert all(p[48][k] is None for k in DETAIL)


def test_epic_kopf_mit_neustarts_und_plaetzen(client, bericht):
    client.post('/api/bericht', json=bericht)
    e = laeufe(client)[38]
    assert (e['neustarts'], e['plaetze']) == (2, {'belegt': 3, 'von': 3})
    # the window may be unknown: the number alone
    bericht['epics'][1]['plaetze'] = {'belegt': 2}
    client.post('/api/bericht', json=bericht)
    assert laeufe(client)[38]['plaetze'] == {'belegt': 2, 'von': None}


def test_laenger_als_ueblich_ist_der_median_der_fertigen_mal_anderthalb(client, bericht):
    client.post('/api/bericht', json=bericht)
    # finished in the example: 42.5, 35, 40, 35 and 40 min, median 40, limit 60 min; #47 runs since 13:05 (86 min), #53 since 14:10
    p = pakete(client, 38)
    assert (p[47]['lang'], p[53]['lang'], p[54]['lang']) == (True, False, False)
    # the finished and the waiting ones never carry it
    assert (p[46]['lang'], p[48]['lang']) == (False, False)
    assert all(not x['lang'] for x in pakete(client, 39).values())


def test_ohne_drei_fertige_pakete_kein_hinweis(client, bericht):
    for ep in bericht['epics']:
        for pk in ep['pakete']:
            if pk['stand'] == 'fertig' and pk['nr'] != 46:
                pk['beginn'] = pk['ende'] = None
    client.post('/api/bericht', json=bericht)
    assert not any(x['lang'] for x in pakete(client, 38).values())


def test_grenze_ist_streng_groesser(client, bericht):
    # three finished of 40 min each: limit 60 min; #47 began 13:05:10, the clock stands at 14:31:10 -> move its start
    for ep in bericht['epics']:
        for pk in ep['pakete']:
            if pk['stand'] == 'fertig':
                pk['beginn'], pk['ende'] = '2026-11-20T09:00:00Z', '2026-11-20T09:40:00Z'
    bericht['epics'][1]['pakete'][1]['beginn'] = '2026-11-20T13:31:10Z'
    client.post('/api/bericht', json=bericht)
    assert pakete(client, 38)[47]['lang'] is False
    bericht['epics'][1]['pakete'][1]['beginn'] = '2026-11-20T13:31:09Z'
    client.post('/api/bericht', json=bericht)
    assert pakete(client, 38)[47]['lang'] is True


def test_aelterer_bericht_ohne_felder_bleibt_gueltig(client, bericht):
    for ep in bericht['epics']:
        ep.pop('neustarts', None)
        ep.pop('plaetze', None)
        for pk in ep['pakete']:
            for k in DETAIL:
                pk.pop(k, None)
    assert client.post('/api/bericht', json=bericht).status_code == 200
    e = laeufe(client)[38]
    assert (e['neustarts'], e['plaetze']) == (None, None)
    assert all(p[k] is None for p in e['pakete'] for k in DETAIL)


def test_spec_modus_hat_keine_detailfelder(client, bericht):
    client.post('/api/bericht', json=bericht)
    e = laeufe(client)[39]
    assert e['plaetze'] is None and e['neustarts'] is None
    assert all(p[k] is None for p in e['pakete'] for k in DETAIL)


def test_ungueltige_werte_werden_abgelehnt(client, bericht):
    bericht['epics'][1]['pakete'][1]['phase'] = 'planung'
    assert client.post('/api/bericht', json=bericht).status_code == 422
    bericht['epics'][1]['pakete'][1]['phase'] = 'review'
    bericht['epics'][1]['pakete'][1]['runde'] = 0
    assert client.post('/api/bericht', json=bericht).status_code == 422


def test_sternenkarte_bekommt_die_felder_der_pakete_mit(client, bericht):
    client.post('/api/bericht', json=bericht)
    p = next(p for p in client.get('/api/tafel').json()['projekte'] if p['forge'] == 'interias/flotte-probe')
    e38 = next(e for e in p['epics'] if e['nr'] == 38)
    assert {x['nr']: x['phase'] for x in e38['pakete']}[54] == 'review'
