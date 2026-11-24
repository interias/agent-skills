# The board from the last reports, in three levels by what the person has to do (#28, v2):
# 1 "Braucht dich": open questions and blocked epics, sorted by the cost of waiting;
# 2 "Unterwegs": running epics, the merge queue, the ready ones as one line;
# 3 "Erledigt heute": merged epics, the admiral's decisions, the person's own answers and actions.
# Each epic not merged carries its decisions (#52): the person's always, the admiral's and the run's
# only when influential, revocable until the merge.
# Above them the accounts with their usage, RAM and disk per machine; below them the ticker. Beside
# them the prototypes of the Holodeck, without their content, and the sessions of the accounts.
# The Sternenkarte (#43) gets its own flat view: every project lists its open epics (`epics`) and
# (#61) the released ones outside the driver's deployment (`freigegeben`), with the steering actions on their way.
# The Frachtraum (#116) gets the triage state of every project whose driver reports one (`frachtraum`),
# with (#148) the cut plan of its last triage run.
# The Maschinenraum (#90) gets the Werft of every machine (`werft`); its messages join the ticker.
# The Bereitschaftsraum (#85) gets its chats (`bereitschaftsraum`).

import json
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .modelle import ABFRAGE_MAX, ABFRAGE_MIN, CHAT_STANDARD_MODELL, HANDLUNG_GRUPPE

HERKUNFT = 'Mensch über die Brücke'
HALT = ('blockiert', 'abgebrochen')
FERTIG = ('gemergt', 'fertig')
# the order of the open epics on the Sternenkarte: what holds the person first, then what runs, then the backlog
# #51: a package that runs longer than LANG_FAKTOR times the median of the project's finished packages, from LANG_AB of them
LANG_FAKTOR = 1.5
LANG_AB = 3
VON = ('mensch', 'admiral', 'lauf')
# #193: a mission at work, as the driver counts it for the occupancy (BELEGT in treiber.ts)
LAUFEND = ('laeuft', 'frage', 'nacharbeit')
KARTE_RANG = {'blockiert': 0, 'abgebrochen': 0, 'frage': 1, 'laeuft': 2, 'nacharbeit': 2, 'pr': 3, 'wartend': 4}
# #116 Frachtraum: the labels of the workflow are no topic (besides status/*); a ticket without a topic
OHNE_THEMA = ('needs-triage', 'needs-info', 'ready-for-agent', 'epic')
OHNE = 'ohne Thema'
# #90: a Werft reports every 15 s; silent this long, its stand is old
WERFT_STILL_S = 180
# #148: how long "Triage-Lauf beendet" stays in the head of the project
BEENDET_MIN = 15


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


def schwelle_lang(epics: list[dict]) -> float | None:
    """Seconds above which a running package counts as "longer than usual": 1.5 times the median duration
    (first seen working to merged) of the finished packages of this project; None below three of them.
    It lives here, not in the driver: the bridge sees every epic of the project and its own clock, and
    it holds for reports of older drivers too."""
    dauern = sorted(
        (e - b).total_seconds()
        for pk in (p for ep in epics for p in ep.get('pakete', []) if p.get('stand') == 'fertig')
        if (b := zeit(pk.get('beginn'))) and (e := zeit(pk.get('ende'))) and e >= b
    )
    if len(dauern) < LANG_AB:
        return None
    n = len(dauern)
    return LANG_FAKTOR * (dauern[n // 2] if n % 2 else (dauern[n // 2 - 1] + dauern[n // 2]) / 2)


def _pakete(pakete: list[dict], url: str | None, schwelle: float | None, jetzt: datetime) -> list[dict]:
    def lang(pk: dict) -> bool:
        b = zeit(pk.get('beginn'))
        return schwelle is not None and pk.get('stand') == 'laeuft' and b is not None and (jetzt - b).total_seconds() > schwelle

    return [{**pk, 'url': f"{url}/issues/{pk['nr']}" if url and pk.get('nr') else None, 'lang': lang(pk)} for pk in pakete]


def _von(d: dict) -> str:
    """Who decided: the driver says so since #52; an older one is read from herkunft."""
    if d.get('von') in VON:
        return d['von']
    return 'mensch' if (d.get('herkunft') or '').startswith('Mensch') else 'admiral'


def _antwort(a: dict | None) -> dict | None:
    return None if a is None else {'option': a['option'], 'text': a['text'] or None, 'zeit': a['zeit'], 'abgeholt': bool(a['abgeholt']), 'quittiert': bool(a['quittiert'])}


def _handlung(h: dict | None) -> dict | None:
    return None if h is None else {'id': h['id'], 'art': h['art'], 'text': h['text'], 'zeit': h['zeit'], 'abgeholt': bool(h['abgeholt']), 'quittiert': bool(h['quittiert'])}


def _einstellungen(b: dict, forge: str, handlungen: list[dict]) -> list[dict] | None:
    """The settings of a project (#59) with the change still on its way to the driver; None: an older driver reports none."""
    if not b.get('einstellungen'):
        return None
    offen = {}
    for h in handlungen:
        if h['forge'] == forge and h['art'] == 'einstellen' and not h['quittiert']:
            offen[json.loads(h['text'])['name']] = h
    return [{**x, 'offen': {'wert': json.loads(offen[x['name']]['text'])['wert'], 'zeit': offen[x['name']]['zeit'], 'abgeholt': bool(offen[x['name']]['abgeholt'])} if x['name'] in offen else None} for x in b['einstellungen']]


def thema_von(labels: list[str]) -> list[str]:
    """#116: the topics of a Sternzeit-Notiz are its labels without the ones of the workflow."""
    return [x for x in labels if x not in OHNE_THEMA and not x.startswith('status/')]


def schnittplan(tr: dict, forge: str, link, offen_h: dict) -> dict | None:
    """#148: the cut plan of the last triage run: per mission its children, its state and the revocation on its
    way; the notes it closed with the note they went into. None: an older driver, or no plan yet."""
    s = tr.get('schnittplan')
    if not s:
        return None
    zustand = lambda m: 'widerrufen' if m.get('widerrufen') else 'fehler' if m.get('fehler') else 'frei' if m.get('freigegeben') else 'offen'
    return {
        'zeit': s['zeit'],
        'fehler': s.get('fehler'),
        'missionen': [{
            **m,
            'id': f"schnitt:{forge}#{m['nr']}",
            'forge': forge,
            'issueUrl': link(m['nr']) or m.get('url'),
            'kinder': [{**k, 'issueUrl': link(k['nr'])} for k in m.get('kinder', [])],
            'zustand': zustand(m),
            'widerrufbar': not m.get('widerrufen') and bool(m.get('neu') or m.get('kinder')),
            'handlung': _handlung(offen_h.get((m['nr'], 'schnitt-widerruf', None, None))),
        } for m in s.get('missionen', [])],
        'notizen': [{**n, 'issueUrl': link(n['nr']), 'verweisUrl': link(n['verweis']) if n.get('verweis') else None} for n in s.get('notizen', [])],
    }


def kurzinfo(tr: dict, handlung: dict | None, jetzt: datetime, fragen: int, veraltet: bool) -> dict | None:
    """#148: the short info of a triage run: unterwegs (the action stands, the driver has not reported a run), laeuft
    (the report says so, with the start and, only if the driver knows it, note n of m), beendet (for BEENDET_MIN minutes)."""
    if tr.get('laeuft'):
        # a silent driver: the report is old, the run may be long over
        return {'zustand': 'laeuft', 'seit': tr.get('seit') or (handlung or {}).get('zeit'), 'fortschritt': tr.get('fortschritt'), 'still': veraltet}
    if handlung:
        return {'zustand': 'unterwegs', 'seit': handlung['zeit'], 'abgeholt': handlung['abgeholt'], 'fortschritt': None}
    e = tr.get('beendet')
    t = zeit(e['zeit']) if e else None
    # a little clock skew between driver and bridge is tolerated
    if t and -timedelta(minutes=2) <= jetzt - t < timedelta(minutes=BEENDET_MIN):
        # the questions the person sees now (still right after an answer), not the new ones of the run
        k = {'zustand': 'beendet', 'seit': e['zeit'], 'epics': e['epics'], 'fragen': fragen, 'gescheitert': bool(e.get('gescheitert')), 'fehler': e.get('fehler')}
        # #147: the run ended incomplete or aborted: said in the same line, the list stands below (abschluss)
        a = tr.get('abschluss')
        if a and a['zustand'] != 'beendet' and not k['gescheitert']:
            k['abschluss'] = {'zustand': a['zustand'], 'unsauber': len(a.get('abweichungen', [])), 'grund': a.get('grund')}
        return k
    return None


def frachtraum(b: dict, forge: str, kurz: str, url: str | None, aktiv: bool, veraltet: bool, offen_h: dict, jetzt: datetime) -> dict:
    """#116: the triage state of a project, bundled: the open questions, the decisions of the triage runs
    (newest first) and the Sternzeit-Notizen by topic; a topic with an open question first, "ohne Thema" last."""
    tr = b['triage']
    link = lambda nr: f'{url}/issues/{nr}' if url else None
    gefragt = {f['ticket'] for f in tr.get('fragen', [])}
    fragen = [{
        'id': f"triage-frage:{forge}#{f['ticket']}#{f['nr']}#{f['seit']}",
        'forge': forge,
        **{k: f.get(k, d) for k, d in [('ticket', 0), ('nr', 0), ('titel', ''), ('frage', ''), ('optionen', []), ('empfehlung', ''), ('grund', ''), ('herkunft', ''), ('marke', ''), ('seit', '')]},
        'issueUrl': link(f['ticket']),
        # a recommendation names its option by letter or by its text
        'empfohlen': empfohlen(f) or [o['buchstabe'] for o in f.get('optionen', []) if o['text'].strip().casefold() == (f.get('empfehlung') or '').strip().casefold()][:1],
        'handlung': _handlung(offen_h.get((f['ticket'], 'triage-antwort', f['nr'], f['seit']))),
    } for f in sorted(tr.get('fragen', []), key=lambda f: (f['seit'], f['ticket'], f['nr']))]
    entscheidungen = [{
        'id': f"triage-entscheidung:{forge}#{d['nr']}#{d['zeit']}",
        'forge': forge,
        **{k: d.get(k, v) for k, v in [('nr', 0), ('titel', ''), ('ergebnis', ''), ('herkunft', ''), ('grund', ''), ('zeit', ''), ('widerrufen', None)]},
        'issueUrl': link(d['nr']),
        'widerrufbar': not d.get('widerrufen'),
        'handlung': _handlung(offen_h.get((d['nr'], 'triage-widerruf', None, d['zeit']))),
    } for d in sorted(tr.get('entscheidungen', []), key=lambda d: d['zeit'], reverse=True)]
    themen: dict[str, list[dict]] = {}
    for t in tr.get('tickets', []):
        eigene = thema_von(t.get('labels', []))
        x = {'nr': t['nr'], 'titel': t.get('titel', ''), 'issueUrl': link(t['nr']), 'labels': t.get('labels', []), 'themen': eigene, 'frage': t['nr'] in gefragt}
        for th in eigene or [OHNE]:
            themen.setdefault(th, []).append(x)
    for liste_t in themen.values():
        liste_t.sort(key=lambda x: (not x['frage'], x['nr']))
    reihe = sorted(themen, key=lambda th: (th == OHNE, not any(x['frage'] for x in themen[th]), th.casefold()))
    return {
        'forge': forge, 'kurz': kurz, 'url': url, 'aktiv': aktiv, 'veraltet': veraltet,
        'gelesen': tr.get('gelesen'), 'laeuft': bool(tr.get('laeuft')), 'zahl': len(tr.get('tickets', [])),
        'handlung': _handlung(offen_h.get((0, 'triage', None, None))),
        'kurzinfo': kurzinfo(tr, _handlung(offen_h.get((0, 'triage', None, None))), jetzt, len(fragen), veraltet),
        'fragen': fragen,
        'entscheidungen': entscheidungen,
        'schnittplan': schnittplan(tr, forge, link, offen_h),
        # #147: the end of the last triage run, each note not cleanly worked off with its link
        'abschluss': {**a, 'abweichungen': [{**x, 'issueUrl': link(x['nr'])} for x in a.get('abweichungen', [])]} if (a := tr.get('abschluss')) else None,
        'themen': [{'thema': th, 'tickets': themen[th]} for th in reihe],
    }


def _werft_einstellungen(r: dict, offen: dict) -> list[dict]:
    """#90: the settings of a repository's Werft in the form of the driver's settings (#59), so the Maschinenraum
    draws both alike; `offen` maps (stack, name) to the change still on its way to the Werft."""
    namen = [s['name'] for s in r['stacks']]
    an = [s['name'] for s in r['stacks'] if s['an']]
    unterwegs = lambda h: {'wert': json.loads(h['text'])['wert'], 'zeit': h['zeit'], 'abgeholt': bool(h['abgeholt'])} if h else None
    janein = lambda h, ja, nein: {**unterwegs(h), 'wert': ja if unterwegs(h)['wert'] else nein} if h else None
    # the stacks on their way: every open change of one stack applied to the list it has now
    je_stack = {s: h for (s, n), h in offen.items() if s is not None and n == 'an'}
    stacks_offen = None
    if je_stack:
        neu = [n for n in namen if (json.loads(je_stack[n]['text'])['wert'] if n in je_stack else n in an)]
        stacks_offen = {'wert': neu, 'zeit': max(h['zeit'] for h in je_stack.values()), 'abgeholt': all(h['abgeholt'] for h in je_stack.values())}
    zeile = lambda name, titel, wert, standard, **mehr: {'name': name, 'titel': titel, 'wert': wert, 'standard': standard, 'herkunft': 'standard' if wert == standard else 'bruecke', 'seit': None, 'leer': False, 'min': None, 'max': None, 'auswahl': None, 'werte': None, 'hinweis': None, **mehr}
    return [
        zeile('an', 'Werft', 'an' if r['an'] else 'aus', 'an', werte=['an', 'aus'], offen=janein(offen.get((None, 'an')), 'an', 'aus')),
        zeile('stacks', 'Stacks', an, namen, auswahl=namen, offen=stacks_offen),
        zeile('abfrage_s', 'Abfrageabstand (s)', r['abfrageGesetzt'], None, leer=True, min=ABFRAGE_MIN, max=ABFRAGE_MAX, adapter=r['abfrageS'] if r['abfrageGesetzt'] is None else None, offen=unterwegs(offen.get((None, 'abfrage_s')))),
        zeile('migration_test', 'Test-Migrationen selbst', 'ja' if r['migrationTest'] else 'nein', 'ja', werte=['ja', 'nein'], offen=janein(offen.get((None, 'migration_test')), 'ja', 'nein')),
    ]


def werft_liste(werft: list[dict], werft_h: list[dict], jetzt: datetime) -> list[dict]:
    """#90: every repository of every machine's Werft, with its stacks, settings and the actions on their way."""
    liste = []
    for w in werft:
        empfangen = zeit(w['empfangen'])
        veraltet = empfangen is None or jetzt - empfangen > timedelta(seconds=WERFT_STILL_S)
        for r in w['bericht']['repos']:
            offen_h = [h for h in werft_h if h['rechner'] == w['rechner'] and h['forge'] == r['forge'] and not h['quittiert']]
            art = lambda stack, a: _handlung(next((h for h in offen_h if h['stack'] == stack and h['art'] == a), None))
            liste.append({
                'id': f"werft:{w['rechner']}|{r['forge']}",
                'rechner': w['rechner'],
                'empfangen': w['empfangen'],
                'veraltet': veraltet,
                'kurz': r['forge'].split('/')[-1],
                **{k: r[k] for k in ('forge', 'branch', 'stand', 'geprueft', 'abfrageS', 'abfrageGesetzt', 'an', 'migrationTest', 'fehler')},
                'stacks': [{**s, 'nachziehen': art(s['name'], 'nachziehen'), 'freigabe': art(s['name'], 'migration_freigeben')} for s in r['stacks']],
                'einstellungen': _werft_einstellungen(r, {(h['stack'], json.loads(h['text'])['name']): h for h in offen_h if h['art'] == 'einstellen'}),
            })
    return sorted(liste, key=lambda x: (x['forge'], x['rechner']))


def tafel(projekte: list[dict], stufen_seit: dict, antworten: list[dict], jetzt: datetime, tz: ZoneInfo, pin_gesetzt: bool, handlungen: list[dict] | None = None, prototypen: list[dict] | None = None, werft: list[dict] | None = None, werft_h: list[dict] | None = None) -> dict:
    heute = jetzt.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    handlungen = handlungen or []
    werft = werft or []
    zu_antwort = {(a['forge'], a['epic'], a['nr'], a['seit']): a for a in antworten}
    braucht, laeufe, schlange_karten, bereit, erledigt, ereignisse = [], [], [], [], [], []
    liste, rechner, konten, lager = [], {}, {}, []
    sitzungen = {}
    kontenliste: dict[tuple[str, int], dict] = {}
    anlegen: dict[str, dict] = {}
    kontenliste_gemeldet = False

    for p in projekte:
        b, forge = p['bericht'], p['forge']
        kurz = forge.split('/')[-1]
        url = b.get('url')
        empfangen = zeit(p['empfangen'])
        takt = b.get('taktS', 60)
        veraltet = empfangen is None or jetzt - empfangen > timedelta(seconds=max(3 * takt, 180))
        aktiv = b.get('aktiv', True) and not veraltet
        liste.append({'forge': forge, 'kurz': kurz, 'url': url, 'empfangen': p['empfangen'], 'aktiv': aktiv, 'veraltet': veraltet, 'rechner': b.get('rechner', ''), 'taktS': takt, 'leerlaufS': b.get('leerlaufS'), 'prognose': b.get('prognose'), 'einstellungen': _einstellungen(b, forge, handlungen), 'version': b.get('version'), 'kontenListe': b.get('kontenListe'), 'forgeStatus': b.get('forgeStatus'), 'meldetForge': b.get('forgeStatus') is not None})
        # the newest report of a machine speaks for its RAM and disk, of an account for its usage
        r = rechner.get(b.get('rechner', ''))
        if r is None or r['empfangen'] < p['empfangen']:
            rechner[b.get('rechner', '')] = {'name': b.get('rechner', ''), 'empfangen': p['empfangen'], 'ram': b.get('ram'), 'platte': b.get('platte'), 'obergrenze': b.get('obergrenze'), 'veraltet': veraltet}
        for k in b.get('konten', []):
            alt = konten.get(k['konto'])
            if alt is None or alt['empfangen'] < p['empfangen']:
                konten[k['konto']] = {'konto': k['konto'], 'stufe': k['stufe'], 'fuenf': k.get('fuenf'), 'woche': k.get('woche'), 'alterMin': k.get('alterMin'), 'grund': k.get('grund'), 'empfangen': p['empfangen'], 'veraltet': veraltet}
        # the sessions of a silent project are old: only live reports count, the newest one wins a session
        for s in b.get('sitzungen', []) if not veraltet else []:
            schluessel = (s['konto'], s['projekt'], s['name'], s['seit'])
            if schluessel not in sitzungen or sitzungen[schluessel][0] < p['empfangen']:
                sitzungen[schluessel] = (p['empfangen'], s)
        for e in b.get('ereignisse', []):
            ereignisse.append({'zeit': e['zeit'], 'forge': forge, 'kurz': kurz, 'epic': e.get('epic'), 'text': e['text']})

        offen_h = {}
        for h in handlungen:
            if h['forge'] == forge and not h['quittiert'] and h['art'] != 'einstellen':
                offen_h[(h['epic'], HANDLUNG_GRUPPE[h['art']], h['nr'], h['seit'])] = h
        # #154: the update on its way to the driver (the button waits for it)
        liste[-1]['einspielen'] = _handlung(offen_h.get((0, 'einspielen', None, None)))
        # #125: linking the forge on its way to the machine
        liste[-1]['verknuepfen'] = _handlung(offen_h.get((0, 'forge_verknuepfen', None, None)))
        # #126: adding a project or removing this one on its way to the driver
        liste[-1]['meldetProjekte'] = bool(b.get('projektHandlungen'))
        liste[-1]['hinzufuegen'] = _handlung(offen_h.get((0, 'projekt_hinzufuegen', None, None)))
        liste[-1]['entfernen'] = _handlung(offen_h.get((0, 'projekt_entfernen', None, None)))
        # #96: the accounts of the machine, the newest report wins; an action goes to the project that reported it
        if b.get('kontenListe') is not None:
            kontenliste_gemeldet = True
            for k in b['kontenListe']:
                schluessel = (b.get('rechner', ''), k['nr'])
                if schluessel not in kontenliste or kontenliste[schluessel]['empfangen'] < p['empfangen']:
                    h = offen_h.get((k['nr'], 'konto_aktiv', None, None)) or offen_h.get((k['nr'], 'konto_anmelden', None, None))
                    kontenliste[schluessel] = {**k, 'rechner': b.get('rechner', ''), 'forge': forge, 'empfangen': p['empfangen'], 'veraltet': veraltet, 'handlung': _handlung(h)}
            a = anlegen.get(b.get('rechner', ''))
            if a is None or a['empfangen'] < p['empfangen']:
                anlegen[b.get('rechner', '')] = {'rechner': b.get('rechner', ''), 'forge': forge, 'empfangen': p['empfangen'], 'handlung': _handlung(offen_h.get((0, 'konto_anlegen', None, None)))}
        epics = {ep['nr']: ep for ep in b.get('epics', [])}
        schwelle = schwelle_lang(b.get('epics', []))
        # #52: the decisions of each epic not merged, newest first; the rest stays in the logbook and at the issues
        entscheidungen: dict[int, list[dict]] = {}
        for d in b.get('entscheidungen', []):
            stufe = epics.get(d['epic'], {}).get('stufe')
            von = _von(d)
            t = zeit(d.get('zeit'))
            if stufe is None or stufe in FERTIG or not t or not (von == 'mensch' or d.get('einflussreich')):
                continue
            entscheidungen.setdefault(d['epic'], []).append({
                'id': f"entscheidung:{forge}#{d['epic']}#{d['nr']}#{d['zeit']}",
                'forge': forge,
                'epic': d['epic'],
                'zeit': t.isoformat(),
                'seit': d['zeit'],
                **{k: d.get(k, v) for k, v in [('nr', 0), ('frage', ''), ('antwort', ''), ('herkunft', ''), ('grund', ''), ('einflussreich', False), ('widerrufen', None)]},
                'von': von,
                'widerrufbar': not d.get('widerrufen'),
                'handlung': _handlung(offen_h.get((d['epic'], 'widerruf', d['nr'], d['zeit']))),
            })
        for liste_e in entscheidungen.values():
            liste_e.sort(key=lambda x: x['zeit'], reverse=True)
        # #61: every card names a pause and the priority of its epic (the Schiffsliste shows both)
        basis = lambda nr: {'forge': forge, 'repo': kurz, 'epic': nr, 'titel': epics.get(nr, {}).get('titel', ''), 'konto': epics.get(nr, {}).get('konto'), 'issueUrl': f'{url}/issues/{nr}' if url else None, 'aktiv': aktiv, 'pausiert': epics.get(nr, {}).get('pausiert'), 'prio': bool(epics.get(nr, {}).get('prio'))}

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
                'pakete': _pakete(ep.get('pakete', []), url, schwelle, jetzt),
                'neustarts': ep.get('neustarts'),
                'plaetze': ep.get('plaetze'),
                'gateLauf': ep.get('gateLauf'),
                'schritt': ep.get('schritt'),
                'schrittZeit': ep.get('schrittZeit'),
                'gestartetAm': ep.get('gestartetAm'),
                'entscheidungen': entscheidungen.get(nr, []),
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
                bereit.append({'forge': forge, 'repo': kurz, 'id': karte['id'], 'nr': nr, 'titel': ep.get('titel', ''), 'issueUrl': karte['issueUrl'], 'notiz': ep.get('notiz', ''), 'prio': bool(ep.get('prio')), 'prognose': ep.get('prognose'), 'pakete': karte['pakete'], 'entscheidungen': karte['entscheidungen'], 'pausiert': ep.get('pausiert')})
                continue
            if stufe == 'pr':
                rein = zeit(ep.get('schlangeSeit')) or seit_stufe
                schlange_karten.append({**karte, 'position': schlange.index(nr) + 1 if nr in schlange else None, 'seit': rein.isoformat() if rein else None, 'gateSeit': ep.get('gateSeit')})
                continue
            # laeuft, nacharbeit, frage: a run; one that waits for the person entirely has no life sign
            laeufe.append({**karte, 'prozess': bool(ep.get('prozess')), 'leerlaufS': b.get('leerlaufS'), 'fragen': offen_je_epic.get(nr, 0), 'wartetAufDich': stufe == 'frage'})

        # ---- the Sternenkarte: the open epics of this project, merged and given-up ones are no backlog
        offen = [ep for ep in b.get('epics', []) if ep['stufe'] not in FERTIG and not (ep['stufe'] in HALT and ep.get('aufgegebenAm'))]
        offene_nr = {ep['nr'] for ep in offen}
        karte = []
        for ep in offen:
            nr = ep['nr']
            kante = lambda n: {'nr': n, 'titel': epics.get(n, {}).get('titel', ''), 'stufe': epics.get(n, {}).get('stufe'), 'offen': n in offene_nr, 'issueUrl': f'{url}/issues/{n}' if url else None}
            karte.append({
                'id': f'epic:{forge}#{nr}',
                'nr': nr,
                'titel': ep.get('titel', ''),
                'stufe': ep['stufe'],
                'prio': bool(ep.get('prio')),
                'konto': ep.get('konto'),
                'issueUrl': f'{url}/issues/{nr}' if url else None,
                'pr': ep.get('pr'),
                'prUrl': f"{url}/pull/{ep['pr']}" if url and ep.get('pr') else None,
                # why it waits or halts: the whole reason of a blockade, else the note
                'warum': (ep.get('grund') or ep.get('notiz', '')) if ep['stufe'] in HALT else ep.get('notiz', ''),
                'fragen': offen_je_epic.get(nr, 0),
                'prognose': ep.get('prognose'),
                'pakete': _pakete(ep.get('pakete', []), url, schwelle, jetzt),
                'nach': [kante(n) for n in sorted(set(ep.get('nach', []))) if n != nr],
                'folgen': sorted(o['nr'] for o in offen if nr in o.get('nach', []) and o['nr'] != nr),
                # #61: steering: in the deployment, paused since, the priority of the bridge, the actions on their way
                'imEinsatz': ep.get('imEinsatz', True),
                'pausiert': ep.get('pausiert'),
                'prioritaet': ep.get('prioritaet'),
                'pause': _handlung(offen_h.get((nr, 'pause', None, None))),
                'vorrang': _handlung(offen_h.get((nr, 'prioritaet', None, None))),
                # #112: how it merges now (an older driver: None, no switch) and the switch on its way
                'merge': ep.get('merge'),
                'andocken': _handlung(offen_h.get((nr, 'merge', None, None))),
            })
        karte.sort(key=lambda k: (KARTE_RANG.get(k['stufe'], 5), not k['prio'], k['nr']))
        liste[-1]['epics'] = karte
        # #61: released epics outside the deployment, to take in; the driver checks the forge again
        if b.get('triage'):
            lager.append(frachtraum(b, forge, kurz, url, aktiv, veraltet, offen_h, jetzt))
        # #193: the row of the collection view in the Maschinenraum; the switch itself is the setting einsammeln
        stufen = [ep['stufe'] for ep in b.get('epics', [])]
        liste[-1]['sammeln'] = {'laufend': sum(s in LAUFEND for s in stufen), 'wartend': stufen.count('wartend'), 'freigegeben': len(b.get('freigegeben', []))}
        liste[-1]['freigegeben'] = [{'nr': f['nr'], 'titel': f.get('titel', ''), 'issueUrl': f"{url}/issues/{f['nr']}" if url else None, 'handlung': _handlung(offen_h.get((f['nr'], 'aufnehmen', None, None)))} for f in b.get('freigegeben', [])]

        # ---- level 3: the admiral's decisions of today, revocable until the merge
        for d in b.get('entscheidungen', []):
            t = zeit(d.get('zeit'))
            # the person's answers are on this level from the bridge's own store (#52: the driver reports them too)
            if not t or t < heute or _von(d) == 'mensch':
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
            x = {'art': 'handlung', 'id': f"handlung:{h['id']}", 'forge': h['forge'], 'repo': h['forge'].split('/')[-1], 'epic': h['epic'], 'nr': h['nr'], 'zeit': t.isoformat(), 'handlung': h['art'], 'text': h['text']}
            if h['art'] == 'einstellen':
                # a setting belongs to the project, not to an epic: the logbook names it by its title
                z = json.loads(h['text'])
                titel = next((e['titel'] for p in projekte if p['forge'] == h['forge'] for e in p['bericht'].get('einstellungen') or [] if e['name'] == z['name']), z['name'])
                x = {**x, 'epic': None, 'titel': titel, 'wert': z['wert']}
            elif h['art'] in ('forge_verknuepfen', 'projekt_entfernen'):
                x = {**x, 'epic': None}
            elif h['art'] == 'projekt_hinzufuegen':
                # #126: the folder by its name only, as in the logbook
                z = json.loads(h['text'])
                x = {**x, 'epic': None, 'text': None, 'ordner': re.split(r'[\\/]', z['ordner'].rstrip('\\/'))[-1], 'autostart': z['autostart']}
            elif h['art'].startswith('konto_'):
                # #95: an account of the machine, no epic
                x = {**x, 'epic': None, 'konto': h['epic'] or None}
            elif h['art'].startswith('triage') or h['art'] == 'einspielen':
                # #116: a ticket of the triage, no epic; #154: the update belongs to the project
                x = {**x, 'epic': None, 'ticket': h['epic'] or None}
            erledigt.append(x)
    # #90: the person's actions for a Werft, once it acknowledged them; a setting by its title and its value in words
    for h in werft_h or []:
        t = zeit(h['quittiert'])
        if not t or t < heute:
            continue
        x = {'art': 'handlung', 'id': f"werft-handlung:{h['id']}", 'werft': True, 'forge': h['forge'], 'repo': h['forge'].split('/')[-1], 'rechner': h['rechner'], 'stack': h['stack'], 'epic': None, 'nr': None, 'zeit': t.isoformat(), 'handlung': h['art'], 'text': h['text']}
        if h['art'] == 'einstellen':
            z = json.loads(h['text'])
            titel = {'an': f"Werft · Stack {h['stack']}" if h['stack'] else 'Werft', 'abfrage_s': 'Werft · Abfrageabstand (s)', 'migration_test': 'Werft · Test-Migrationen selbst'}.get(z['name'], z['name'])
            wert = z['wert']
            if isinstance(wert, bool):
                wert = ('ja' if wert else 'nein') if z['name'] == 'migration_test' else ('an' if wert else 'aus')
            x = {**x, 'titel': titel, 'wert': wert}
        erledigt.append(x)

    # #90: the messages of the Werft, kept by the bridge (a report carries only those of one takt)
    for w in werft:
        repos = {r['forge'] for r in w['bericht']['repos']}
        for m in w['meldungen']:
            forge = m['text'].split(': ', 1)[0]
            ereignisse.append({'zeit': m['zeit'], 'forge': forge if forge in repos else None, 'kurz': 'Werft', 'epic': None, 'text': m['text']})

    # the cost of waiting: what holds a whole epic first, then the longest wait
    braucht.sort(key=lambda x: (0 if x['ganzerLauf'] else 1, -(x['wartetS'] or 0), x['forge'], x['epic'], x.get('nr') or 0))
    laeufe.sort(key=lambda c: (c['wartetAufDich'], c['forge'], c['nr']))
    schlange_karten.sort(key=lambda c: (c['position'] or 999, c['forge'], c['nr']))
    bereit.sort(key=lambda c: (not c['prio'], c['forge'], c['nr']))
    erledigt.sort(key=lambda x: x['zeit'], reverse=True)
    ereignisse.sort(key=lambda e: e['zeit'], reverse=True)
    # #116: the projects with an open question of the triage first
    lager.sort(key=lambda p: (not p['fragen'], p['forge']))
    # a session belongs to the project whose repository name is its folder name, else to none ("Sonstige")
    forge_von = {p['kurz'].lower(): p['forge'] for p in reversed(liste)}
    sitzungen_liste = sorted(
        ({**{k: s[k] for k in ('konto', 'projekt', 'name', 'status', 'kind', 'seit')}, 'forge': forge_von.get(s['projekt'].lower())} for _, s in sitzungen.values()),
        key=lambda s: (s['konto'], s['projekt'], s['seit'], s['name']),
    )
    # #96: the sign-in fills the tank of the account by its short name
    for k in kontenliste.values():
        if f"Konto {k['nr']}" in konten:
            konten[f"Konto {k['nr']}"]['anmeldung'] = k['anmeldung']
    konten_liste = sorted(kontenliste.values(), key=lambda k: (k['rechner'], k['nr']))
    return {
        'jetzt': jetzt.isoformat(),
        'pin': pin_gesetzt,
        'kontenListe': konten_liste,
        'anlegen': sorted(anlegen.values(), key=lambda a: a['rechner']),
        'einrichten': einrichten(konten_liste, list(anlegen.values()), bool(konten), kontenliste_gemeldet, liste),
        'herkunft': HERKUNFT,
        'projekte': liste,
        'rechner': sorted(rechner.values(), key=lambda r: r['name']),
        'konten': sorted(konten.values(), key=lambda k: k['konto']),
        'braucht': braucht,
        'unterwegs': {'laeufe': laeufe, 'schlange': schlange_karten, 'bereit': bereit},
        'erledigt': erledigt,
        'ereignisse': ereignisse[:40],
        # Holodeck (#44): name and forge are checked on receipt, the page opens url in its sealed frame
        'sitzungen': sitzungen_liste,
        'frachtraum': lager,
        'werft': werft_liste(werft, werft_h or [], jetzt),
        'prototypen': [{**p, 'kurz': p['forge'].split('/')[-1], 'url': f"/holodeck/{p['forge']}/{p['name']}"} for p in prototypen or []],
    }


def einrichten(konten_liste: list[dict], anlegen: list[dict], tanks: bool, gemeldet: bool, projekte: list[dict]) -> dict:
    """#96: the guided start, in this order: account, sign-in at the machine, forge, project; each offen, wartet
    (an action waits for the machine) or fertig. The forge is done when a driver reports it signed in with push rights (#125); an older
    driver without kontenListe that reports accounts counts as signed in (its runs work)."""
    def stand(fertig: bool, wartet: bool) -> str:
        return 'fertig' if fertig else 'wartet' if wartet else 'offen'

    hat_konto = bool(konten_liste) or tanks
    schritte = [
        {'schritt': 'konto', 'stand': stand(hat_konto, any(a['handlung'] for a in anlegen))},
        {'schritt': 'anmeldung', 'stand': stand(any(k['anmeldung'] == 'angemeldet' for k in konten_liste) or (tanks and not gemeldet), any((k['handlung'] or {}).get('art') == 'konto_anmelden' for k in konten_liste))},
        # #125: a project whose driver reports its forge signed in with push rights; an older driver without forgeStatus (or one before its first check) works, so it counts
        {'schritt': 'forge', 'stand': stand(any(not p['meldetForge'] or (p['forgeStatus'] and p['forgeStatus']['angemeldet'] and p['forgeStatus']['rechte'] == 'ok') for p in projekte), any(p['verknuepfen'] for p in projekte))},
        # #126: a project added over the bridge waits for the machine of a running driver, also when others are there
        {'schritt': 'projekt', 'stand': 'wartet' if any(p['hinzufuegen'] for p in projekte) else stand(bool(projekte), False)},
    ]
    return {'schritte': schritte, 'fertig': all(s['stand'] == 'fertig' for s in schritte)}


def bereitschaftsraum(chats: list[dict], nachrichten: list[dict], rechner: list[dict], forges: list[str], pin_gesetzt: bool) -> dict:
    """#85: the chats of the Bereitschaftsraum for the page, open ones first, the newest on top. Per chat
    the course of messages and answers, the question cards of the last answer, the latest draft (the one
    "anlegen" takes word for word) and the missions created. The accounts come from what the chat service
    of each machine reports (short names only); a bound chat offers those of its machine."""
    konten: dict[str, list[str]] = {}
    for r in rechner:
        for k in r['konten']:
            konten.setdefault(k, []).append(r['name'])
    je_rechner = {r['name']: r['konten'] for r in rechner}
    je_chat: dict[int, list[dict]] = {}
    for n in nachrichten:
        je_chat.setdefault(n['chat'], []).append(n)
    liste = []
    for c in chats:
        eigene = je_chat.get(c['id'], [])
        verlauf = [{
            'id': n['id'], 'art': n['art'], 'text': n['text'], 'starten': n['starten'], 'zeit': n['zeit'],
            'quittiert': n['quittiert'] is not None, 'rechner': n['rechner'],
            'antwort': None if n['antwort'] is None else {**n['antwort'], 'zeit': n['beantwortet']},
        } for n in eigene]
        # a discarded chat waits for nothing: its message no longer goes to the service
        wartet = c['stand'] == 'offen' and any(n['antwort'] is None for n in eigene)
        letzte = eigene[-1] if eigene else None
        mit = [n for n in eigene if n['antwort'] and n['antwort'].get('entwurf')]
        entwurf = {'von': mit[-1]['id'], 'text': mit[-1]['antwort']['entwurf']} if mit else None
        missionen = [m for n in eigene if n['art'] == 'anlegen' and n['antwort'] and n['antwort']['fehler'] is None for m in n['antwort'].get('missionen') or []]
        erste = next((n['text'] for n in eigene if n['art'] == 'text'), '') or ''
        liste.append({
            'id': c['id'], 'forge': c['forge'], 'kurz': c['forge'].split('/')[-1], 'konto': c['konto'], 'modell': c['modell'],
            'stand': c['stand'], 'rechner': c['rechner'], 'angelegt': c['angelegt'], 'geaendert': c['geaendert'],
            'titel': erste.splitlines()[0][:120] if erste.strip() else f"Chat {c['id']}",
            'konten': je_rechner.get(c['rechner'], []) if c['rechner'] else sorted(konten, key=int),
            'wartet': wartet,
            'karten': letzte['antwort']['karten'] if letzte and letzte['antwort'] else [],
            'entwurf': entwurf,
            'anlegbar': bool(entwurf) and c['stand'] == 'offen' and not wartet,
            'missionen': missionen,
            'verlauf': verlauf,
        })
    liste.sort(key=lambda x: x['geaendert'], reverse=True)
    liste.sort(key=lambda x: x['stand'] != 'offen')
    return {
        'pin': pin_gesetzt,
        'modell': CHAT_STANDARD_MODELL,
        'konten': [{'konto': k, 'rechner': konten[k]} for k in sorted(konten, key=int)],
        'rechner': rechner,
        'projekte': sorted(set(forges) | {c['forge'] for c in chats}),
        'chats': liste,
    }
