"""Tag J: the page of the history (verlauf.js, verlauf.css). It is loaded after the board, reads only and every card
under Unterwegs offers it."""

import re
from pathlib import Path

STATIC = Path(__file__).parent.parent / 'app' / 'static'


def test_verlauf_wird_mit_inhaltsstand_nach_dem_board_geladen(client):
    html = client.get('/').text
    stand = re.search(r'/static/app\.js\?v=([0-9a-f]{12})"', html).group(1)
    for n in ('verlauf.css', 'verlauf.js'):
        assert f'/static/{n}?v={stand}"' in html
        assert client.get(f'/static/{n}?v={stand}').status_code == 200
    # it uses the board's helpers, so it comes after app.js
    assert html.index('/static/app.js?v=') < html.index('/static/verlauf.js?v=')


def test_die_skripte_der_seite_deklarieren_keinen_namen_doppelt():
    # classic scripts share one global scope: a second top-level const or let of a name stops the whole page
    seite = (STATIC / 'index.html').read_text(encoding='utf-8')
    namen = {}
    for src in re.findall(r'<script src="/static/([^"?]+)"', seite):
        js = (STATIC / src).read_text(encoding='utf-8')
        for n in re.findall(r'^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)', js, re.M):
            namen.setdefault(n, []).append(src)
    assert {n: q for n, q in namen.items() if len(q) > 1} == {}


def test_verlauf_liest_nur():
    js = (STATIC / 'verlauf.js').read_text(encoding='utf-8')
    # one request, a GET of the history; nothing goes to a run
    assert re.findall(r'fetch\(`?([^`?]+)', js) == ['/api/verlauf']
    assert not re.search(r'method:|sendBeacon|XMLHttpRequest|/api/(antwort|handlung)', js)


def test_jede_karte_unter_unterwegs_bietet_den_verlauf():
    js = (STATIC / 'app.js').read_text(encoding='utf-8')
    lauf = js[js.index('function laufHtml(x) {'):js.index('// the driver\'s line (lage)')]
    assert lauf.count('${VERLAUF_KNOPF}`;') == 4
    assert 'data-verlauf' in js


def test_verlauf_ohne_bewegung_bei_reduzierter_bewegung_und_ohne_lokale_pfade():
    css = (STATIC / 'verlauf.css').read_text(encoding='utf-8')
    still = css[css.index('@media (prefers-reduced-motion: reduce)'):]
    assert 'transition: none' in still and 'animation: none' in still
    for n in ('verlauf.js', 'verlauf.css'):
        assert not re.search(r'[A-Za-z]:\\\\Users|/home/\w|/Users/\w', (STATIC / n).read_text(encoding='utf-8'))
