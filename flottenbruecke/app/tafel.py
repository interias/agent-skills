# The board from the last reports, in three levels by what the person has to do (#28, v2):
# 1 "Braucht dich": open questions and blocked epics, sorted by the cost of waiting;
# 2 "Unterwegs": running epics, the merge queue, the ready ones as one line;
# 3 "Erledigt heute": merged epics, the admiral's decisions, the person's own answers and actions.
# Above them the accounts with their usage, RAM and disk per machine; below them the ticker.

import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

HERKUNFT = 'Mensch über die Brücke'
HALT = ('blockiert', 'abgebrochen')
FERTIG = ('gemergt', 'fertig')


def zeit(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        t = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=ZoneInfo('UTC'))


def buchstaben(text: str | None) -> list[str]:
    """The letters at the start of an answer or recommendation: 'B', 'A, C', 'B) mit Zusatz'."""
    m = re.match(r'\s*([A-Z](?:\s*[,;]\s*[A-Z])*)(?![\wÄÖÜäöüß])', text or '')
    return re.split(r'\s*[,;]\s*', m.group(1)) if m else []


def empfohlen(f: dict) -> list[str]:
    """The letters of the recommended options (several only for a multiple choice)."""
    da = [o['buchstabe'] for o in f.get('optionen', [])]
    wahl = [b for b in buchstaben(f.get('empfehlung')) if b in da]
    return wahl if f.get('mehrfach') else wahl[:1]


def _antwort(a: dict | None) -> dict | None:
    return None if a is None else {'option': a['option'], 'text': a['text'] or None, 'zeit': a['zeit'], 'abgeholt': bool(a['abgeholt']), 'quittiert': bool(a['quittiert'])}


def _handlung(h: dict | None) -> dict | None:
    return None if h is None else {'id': h['id'], 'art': h['art'], 'text': h['text'], 'zeit': h['zeit'], 'abgeholt': bool(h['abgeholt']), 'quittiert': bool(h['quittiert'])}


def tafel(projekte: list[dict], stufen_seit: dict, antworten: list[dict], jetzt: datetime, tz: ZoneInfo, pin_gesetzt: bool, handlungen: list[dict] | None = None) -> dict:
    heute = jetzt.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    handlungen = handlungen or []
    zu_antwort = {(a['forge'], a['epic'], a['nr'], a['seit']): a for a in antworten}
    braucht, laeufe, schlange_karten, bereit, erledigt, ereignisse = [], [], [], [], [], []
    liste, rechner, konten = [], {}, {}

    for p in projekte:
        b, forge = p['bericht'], p['forge']
        kurz = forge.split('/')[-1]
        url = b.get('url')
        empfangen = zeit(p['empfangen'])
        takt = b.get('taktS', 60)
        veraltet = empfangen is None or jetzt - empfangen > timedelta(seconds=max(3 * takt, 180))
        aktiv = b.get('aktiv', True) and not veraltet
        liste.append({'forge': forge, 'kurz': kurz, 'url': url, 'empfangen': p['empfangen'], 'aktiv': aktiv, 'veraltet': veraltet, 'rechner': b.get('rechner', ''), 'taktS': takt, 'leerlaufS': b.get('leerlaufS'), 'prognose': b.get('prognose')})
        # the newest report of a machine speaks for its RAM and disk, of an account for its usage
        r = rechner.get(b.get('rechner', ''))
        if r is None or r['empfangen'] < p['empfangen']:
            rechner[b.get('rechner', '')] = {'name': b.get('rechner', ''), 'empfangen': p['empfangen'], 'ram': b.get('ram'), 'platte': b.get('platte'), 'obergrenze': b.get('obergrenze'), 'veraltet': veraltet}
        for k in b.get('konten', []):
            alt = konten.get(k['konto'])
            if alt is None or alt['empfangen'] < p['empfangen']:
                konten[k['konto']] = {'konto': k['konto'], 'stufe': k['stufe'], 'fuenf': k.get('fuenf'), 'woche': k.get('woche'), 'alterMin': k.get('alterMin'), 'empfangen': p['empfangen'], 'veraltet': veraltet}
        for e in b.get('ereignisse', []):
            ereignisse.append({'zeit': e['zeit'], 'forge': forge, 'kurz': kurz, 'epic': e.get('epic'), 'text': e['text']})

        offen_h = {}
        for h in handlungen:
            if h['forge'] == forge and not h['quittiert']:
                offen_h[(h['epic'], h['art'] if h['art'] == 'widerruf' else 'halt', h['nr'], h['seit'])] = h
        epics = {ep['nr']: ep for ep in b.get('epics', [])}
        basis = lambda nr: {'forge': forge, 'repo': kurz, 'epic': nr, 'titel': epics.get(nr, {}).get('titel', ''), 'konto': epics.get(nr, {}).get('konto'), 'issueUrl': f'{url}/issues/{nr}' if url else None, 'aktiv': aktiv}

        # ---- level 1: questions
        offen_je_epic: dict[int, int] = {}
        for f in b.get('fragen', []):
            if f.get('beantwortet'):
                continue
            offen_je_epic[f['epic']] = offen_je_epic.get(f['epic'], 0) + 1
            seit = zeit(f.get('seit'))
            ganz = f.get('ganzerLauf', True)
            pakete = epics.get(f['epic'], {}).get('pakete', [])
            braucht.append({
                **basis(f['epic']),
                'art': 'frage',
                'id': f"frage:{forge}#{f['epic']}#{f['nr']}#{f['seit']}",
                **{k: f.get(k, d) for k, d in [('nr', 0), ('frage', ''), ('lage', ''), ('optionen', []), ('mehrfach', False), ('empfehlung', ''), ('grund', ''), ('herkunft', ''), ('marke', ''), ('umkehrbar', None), ('betrifft', ''), ('wartet', ''), ('geparkt', []), ('seit', ''), ('roh', '')]},
                'ganzerLauf': ganz,
                'paketeGesamt': len(pakete) or None,
                'empfohlen': empfohlen(f),
                'antwort': _antwort(zu_antwort.get((forge, f['epic'], f['nr'], f['seit']))),
                'wartetS': int((jetzt - seit).total_seconds()) if seit else None,
            })

        # ---- epics: level 1 (blocked), 2 (on the way), 3 (merged or given up today)
        schlange = b.get('schlange', [])
        for ep in b.get('epics', []):
            nr, stufe = ep['nr'], ep['stufe']
            seit_stufe = zeit(stufen_seit.get((forge, nr)))
            karte = {
                **basis(nr),
                'id': f'epic:{forge}#{nr}',
                'nr': nr,
                'stufe': stufe,
                'pr': ep.get('pr'),
                'prUrl': f"{url}/pull/{ep['pr']}" if url and ep.get('pr') else None,
                'notiz': ep.get('notiz', ''),
                'geparkt': ep.get('geparkt', []),
                'pakete': [{**pk, 'url': f"{url}/issues/{pk['nr']}" if url and pk.get('nr') else None} for pk in ep.get('pakete', [])],
                'schritt': ep.get('schritt'),
                'schrittZeit': ep.get('schrittZeit'),
                'gestartetAm': ep.get('gestartetAm'),
            }
            if stufe in HALT and ep.get('aufgegebenAm'):
                t = zeit(ep['aufgegebenAm'])
                if t and t >= heute:
                    erledigt.append({**karte, 'art': 'aufgegeben', 'zeit': t.isoformat()})
                continue
            if stufe in HALT:
                halt = zeit(ep.get('haltZeit')) or seit_stufe
                braucht.append({
                    **karte,
                    'art': 'blockade',
                    'grund': ep.get('grund') or ep.get('notiz', ''),
                    'log': ep.get('log', []),
                    'seit': halt.isoformat() if halt else None,
                    'wartetS': int((jetzt - halt).total_seconds()) if halt else None,
                    'ganzerLauf': True,
                    'handlung': _handlung(offen_h.get((nr, 'halt', None, None))),
                })
                continue
            if stufe in FERTIG:
                t = zeit(ep.get('gemergtAm')) or seit_stufe
                if t and t >= heute:
                    erledigt.append({**karte, 'art': 'gemergt', 'zeit': t.isoformat()})
                continue
            if stufe == 'wartend':
                bereit.append({'forge': forge, 'repo': kurz, 'id': karte['id'], 'nr': nr, 'titel': ep.get('titel', ''), 'issueUrl': karte['issueUrl'], 'notiz': ep.get('notiz', ''), 'prio': bool(ep.get('prio')), 'prognose': ep.get('prognose'), 'pakete': karte['pakete']})
                continue
            if stufe == 'pr':
                rein = zeit(ep.get('schlangeSeit')) or seit_stufe
                schlange_karten.append({**karte, 'position': schlange.index(nr) + 1 if nr in schlange else None, 'seit': rein.isoformat() if rein else None, 'gateSeit': ep.get('gateSeit')})
                continue
            # laeuft, nacharbeit, frage: a run; one that waits for the person entirely has no life sign
            laeufe.append({**karte, 'prozess': bool(ep.get('prozess')), 'leerlaufS': b.get('leerlaufS'), 'fragen': offen_je_epic.get(nr, 0), 'wartetAufDich': stufe == 'frage'})

        # ---- level 3: the admiral's decisions of today, revocable until the merge
        for d in b.get('entscheidungen', []):
            t = zeit(d.get('zeit'))
            if not t or t < heute:
                continue
            stufe = epics.get(d['epic'], {}).get('stufe')
            erledigt.append({
                **basis(d['epic']),
                'art': 'admiral',
                'id': f"admiral:{forge}#{d['epic']}#{d['nr']}#{d['zeit']}",
                'zeit': t.isoformat(),
                'seit': d['zeit'],
                **{k: d.get(k, v) for k, v in [('nr', 0), ('frage', ''), ('antwort', ''), ('herkunft', ''), ('grund', ''), ('einflussreich', False), ('widerrufen', None)]},
                'widerrufbar': stufe is not None and stufe not in FERTIG and not d.get('widerrufen'),
                'handlung': _handlung(offen_h.get((d['epic'], 'widerruf', d['nr'], d['zeit']))),
            })

    # ---- level 3: the person's own answers and actions, once the driver acknowledged them
    for a in antworten:
        t = zeit(a['quittiert'])
        if t and t >= heute:
            erledigt.append({'art': 'antwort', 'id': f"antwort:{a['id']}", 'forge': a['forge'], 'repo': a['forge'].split('/')[-1], 'epic': a['epic'], 'nr': a['nr'], 'zeit': t.isoformat(), 'option': a['option'], 'text': a['text'] or None})
    for h in handlungen:
        t = zeit(h['quittiert'])
        if t and t >= heute and h['art'] != 'aufgeben':
            erledigt.append({'art': 'handlung', 'id': f"handlung:{h['id']}", 'forge': h['forge'], 'repo': h['forge'].split('/')[-1], 'epic': h['epic'], 'nr': h['nr'], 'zeit': t.isoformat(), 'handlung': h['art'], 'text': h['text']})

    # the cost of waiting: what holds a whole epic first, then the longest wait
    braucht.sort(key=lambda x: (0 if x['ganzerLauf'] else 1, -(x['wartetS'] or 0), x['forge'], x['epic'], x.get('nr') or 0))
    laeufe.sort(key=lambda c: (c['wartetAufDich'], c['forge'], c['nr']))
    schlange_karten.sort(key=lambda c: (c['position'] or 999, c['forge'], c['nr']))
    bereit.sort(key=lambda c: (not c['prio'], c['forge'], c['nr']))
    erledigt.sort(key=lambda x: x['zeit'], reverse=True)
    ereignisse.sort(key=lambda e: e['zeit'], reverse=True)
    return {
        'jetzt': jetzt.isoformat(),
        'pin': pin_gesetzt,
        'herkunft': HERKUNFT,
        'projekte': liste,
        'rechner': sorted(rechner.values(), key=lambda r: r['name']),
        'konten': sorted(konten.values(), key=lambda k: k['konto']),
        'braucht': braucht,
        'unterwegs': {'laeufe': laeufe, 'schlange': schlange_karten, 'bereit': bereit},
        'erledigt': erledigt,
        'ereignisse': ereignisse[:40],
    }
