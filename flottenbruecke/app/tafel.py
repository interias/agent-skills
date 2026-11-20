# The board from the last reports: one card per epic in one of six columns, the header with the
# brakes per account, RAM and disk per machine.

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

SPALTEN = [
    ('bereit', 'Bereit'),
    ('laeuft', 'Läuft'),
    ('frage', 'Frage an dich'),
    ('schlange', 'Merge-Schlange'),
    ('gemergt', 'Gemergt (heute)'),
    ('blockiert', 'Blockiert'),
]

HERKUNFT = 'Mensch über die Brücke'


def zeit(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        t = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=ZoneInfo('UTC'))


def spalte(stufe: str, offene_frage: bool, gemergt: datetime | None, heute: datetime) -> str | None:
    if stufe in ('blockiert', 'abgebrochen'):
        return 'blockiert'
    if offene_frage or stufe == 'frage':
        return 'frage'
    if stufe == 'wartend':
        return 'bereit'
    if stufe in ('laeuft', 'nacharbeit'):
        return 'laeuft'
    if stufe == 'pr':
        return 'schlange'
    # gemergt, fertig: only what came in today
    return 'gemergt' if gemergt is not None and gemergt >= heute else None


def empfohlen(f: dict) -> str | None:
    """The letter of the recommended option: the recommendation is a letter or starts with one."""
    e = (f.get('empfehlung') or '').strip()
    for o in f.get('optionen', []):
        b = o['buchstabe'].strip().rstrip(')')
        if e == b or e.startswith(f'{b})') or e.startswith(f'{b} ') or e.startswith(f'{b}:'):
            return o['buchstabe']
    return None


def tafel(projekte: list[dict], stufen_seit: dict, antworten: list[dict], jetzt: datetime, tz: ZoneInfo, pin_gesetzt: bool) -> dict:
    heute = jetzt.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    spalten: dict[str, list[dict]] = {k: [] for k, _ in SPALTEN}
    zu_antwort = {(a['forge'], a['epic'], a['nr'], a['seit']): a for a in antworten}
    liste, rechner, konten = [], {}, {}
    for p in projekte:
        b, forge = p['bericht'], p['forge']
        empfangen = zeit(p['empfangen'])
        veraltet = empfangen is None or jetzt - empfangen > timedelta(seconds=max(3 * b.get('taktS', 60), 180))
        liste.append({'forge': forge, 'kurz': forge.split('/')[-1], 'url': b.get('url'), 'empfangen': p['empfangen'], 'aktiv': b.get('aktiv', True) and not veraltet, 'veraltet': veraltet, 'rechner': b.get('rechner', '')})
        # the newest report of a machine speaks for its RAM and disk, of an account for its brake
        r = rechner.get(b.get('rechner', ''))
        if r is None or r['empfangen'] < p['empfangen']:
            rechner[b.get('rechner', '')] = {'name': b.get('rechner', ''), 'empfangen': p['empfangen'], 'ram': b.get('ram'), 'platte': b.get('platte'), 'obergrenze': b.get('obergrenze'), 'veraltet': veraltet}
        for k in b.get('konten', []):
            alt = konten.get(k['konto'])
            if alt is None or alt['empfangen'] < p['empfangen']:
                konten[k['konto']] = {'konto': k['konto'], 'stufe': k['stufe'], 'empfangen': p['empfangen'], 'veraltet': veraltet}

        offen: dict[int, list[dict]] = {}
        for f in b.get('fragen', []):
            if f.get('beantwortet'):
                continue
            a = zu_antwort.get((forge, f['epic'], f['nr'], f['seit']))
            offen.setdefault(f['epic'], []).append({**f, 'empfohlen': empfohlen(f), 'antwort': None if a is None else {'text': a['text'], 'zeit': a['zeit'], 'abgeholt': bool(a['abgeholt']), 'quittiert': bool(a['quittiert'])}})
        schlange = b.get('schlange', [])
        for ep in b.get('epics', []):
            gemergt = zeit(ep.get('gemergtAm')) or (zeit(stufen_seit.get((forge, ep['nr']))) if ep['stufe'] in ('gemergt', 'fertig') else None)
            s = spalte(ep['stufe'], bool(offen.get(ep['nr'])), gemergt, heute)
            if s is None:
                continue
            url = b.get('url')
            spalten[s].append({
                'id': f"{forge}#{ep['nr']}",
                'forge': forge,
                'repo': forge.split('/')[-1],
                'nr': ep['nr'],
                'titel': ep.get('titel', ''),
                'stufe': ep['stufe'],
                'konto': ep.get('konto'),
                'pr': ep.get('pr'),
                'issueUrl': f"{url}/issues/{ep['nr']}" if url else None,
                'prUrl': f"{url}/pull/{ep['pr']}" if url and ep.get('pr') else None,
                'notiz': ep.get('notiz', ''),
                'geparkt': ep.get('geparkt', []),
                'pakete': ep.get('pakete', []),
                'schritt': ep.get('schritt'),
                'schrittZeit': ep.get('schrittZeit'),
                'gemergtAm': gemergt.isoformat() if gemergt else None,
                'position': schlange.index(ep['nr']) + 1 if ep['nr'] in schlange else None,
                'fragen': offen.get(ep['nr'], []),
            })
    for k, karten in spalten.items():
        karten.sort(key=lambda c: (c['position'] or 999, c['forge'], c['nr']) if k == 'schlange' else (c['forge'], c['nr']))
    return {
        'jetzt': jetzt.isoformat(),
        'pin': pin_gesetzt,
        'herkunft': HERKUNFT,
        'projekte': liste,
        'rechner': sorted(rechner.values(), key=lambda r: r['name']),
        'konten': sorted(konten.values(), key=lambda k: k['konto']),
        'spalten': [{'id': k, 'titel': t, 'karten': spalten[k]} for k, t in SPALTEN],
    }
