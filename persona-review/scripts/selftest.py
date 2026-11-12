"""Self-test for personakit.py and probe.py against a fixture page on 127.0.0.1.

    python -P selftest.py

Set PERSONAKIT_BROWSER to a Chromium executable when Playwright's own browser is missing.

Serves a tiny app from a temp dir: a login page that sets a cookie, a case page with an overlay
that covers the page until "Later" is clicked, a field, and a link that a guard dialog stops
while the field is dirty. Case "deaf" has no guard. Checks: run() logs in, opens the case,
clears the overlay, takes a screenshot and tallies clicks; the probe says ok for case 1 and
deaf for case "deaf"; without overlay_buttons the swallowed click shows as not_left.
"""
import functools
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))

LOGIN = """<!doctype html><title>login</title><script>
document.cookie = 'session=1; path=/';
location.replace(new URLSearchParams(location.search).get('next'));
</script>"""

CASE = """<!doctype html><title>case</title>
<script>if (!document.cookie.includes('session=1')) location.replace('/login.html?next=' +
  encodeURIComponent(location.pathname + location.search));</script>
<h1>Case</h1><label>City <input name="city" value="Sampletown"></label>
<p><a href="/index.html">Overview</a></p>
<div id="ov" style="display:none;position:fixed;inset:0;background:#0008">
  <div role="dialog"><button onclick="ov.remove()">Later</button></div></div>
<div id="guard" role="alertdialog" style="display:none">Unsaved changes</div>
<script>
setTimeout(() => ov.style.display = 'block', 300);
const deaf = new URLSearchParams(location.search).get('id') === 'deaf';
let dirty = false;
document.querySelector('[name=city]').addEventListener('input', () => dirty = true);
document.querySelector('a').addEventListener('click', e => {
  if (dirty && !deaf) { e.preventDefault(); guard.style.display = 'block'; } });
addEventListener('beforeunload', e => { if (dirty && !deaf) e.preventDefault(); });
</script>"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(root):
    handler = functools.partial(QuietHandler, directory=root)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    tmp = tempfile.mkdtemp(prefix='personakit-selftest-')
    site, kit = os.path.join(tmp, 'site'), os.path.join(tmp, 'kit')
    os.makedirs(site)
    os.makedirs(kit)
    for name, body in (('login.html', LOGIN), ('case.html', CASE), ('index.html', '<h1>Overview</h1>')):
        with open(os.path.join(site, name), 'w', encoding='utf-8') as f:
            f.write(body)
    for name in ('personakit.py', 'probe.py'):
        shutil.copy(os.path.join(HERE, name), kit)
    srv = serve(site)
    cfg = {'base_url': f'http://127.0.0.1:{srv.server_port}', 'case_path': '/case.html?id={id}',
           'login': {'mode': 'url', 'path': '/login.html?next={next}', 'wait_url': r'/case\.html'},
           'overlay_buttons': ['Later'], 'settle_ms': 500, 'timeout_ms': 5000,
           'probe': {'leave': {'role': 'link', 'name': '^Overview$'}, 'guard_selector': '[role=alertdialog]',
                     'change_selector': 'input[name=city]', 'wait_ms': 800, 'after_leave_ms': 800},
           'browser_executable': os.environ.get('PERSONAKIT_BROWSER')}

    def write_cfg():
        with open(os.path.join(kit, 'kit.json'), 'w', encoding='utf-8') as f:
            json.dump(cfg, f)

    write_cfg()
    sys.path.insert(0, kit)
    import personakit
    import probe

    failures = []

    def check(name, ok):
        print(('PASS ' if ok else 'FAIL ') + name)
        if not ok:
            failures.append(name)

    def steps(page, k):
        k.count('find the field', 2, search=True)
        k.count('edit city', 3)
        return k.shot('case'), page.inner_text('h1'), page.locator('#ov').count()

    png, h1, overlays = personakit.run('tester', '1', steps, kit=kit)
    check('run: logged in and opened the case', h1 == 'Case')
    check('run: overlay clicked away', overlays == 0)
    check('run: screenshot written', os.path.getsize(png) > 0)
    check('tally: steps and search summed', personakit.tally('tester', kit) ==
          [('find the field', 2, 2), ('edit city', 3, 0)])
    try:
        personakit.assert_local('https://app.example.com')
        check('assert_local refuses a remote host', False)
    except SystemExit:
        check('assert_local refuses a remote host', True)

    out = os.path.join(tmp, 'probe.json')
    code = probe.main(kit, ['1', 'deaf'], out)
    verdicts = {r['id']: r['verdict'] for r in json.load(open(out, encoding='utf-8'))}
    check('probe: case 1 ok', verdicts.get('1') == 'ok')
    check('probe: guardless case is deaf', verdicts.get('deaf') == 'deaf')
    check('probe: exit code 2 for deaf', code == 2)

    cfg['overlay_buttons'] = []
    write_cfg()
    probe.main(kit, ['1'], out)
    verdict = json.load(open(out, encoding='utf-8'))[0]['verdict']
    check('probe: overlay left in place swallows the leave click', verdict in ('not_left', 'deaf'))

    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print('selftest:', 'FAILED ' + ', '.join(failures) if failures else 'all passed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
