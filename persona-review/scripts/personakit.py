"""Browser kit for persona agents. Local test instances only.

The host copies this file into <round>/kit/ and writes <round>/kit/kit.json from the project
adapter (format: references/adapter.md of the skill). A persona script then does:

    import sys; sys.path.insert(0, KIT_DIR)
    from personakit import run

    def steps(page, kit):
        page.get_by_role('tab', name='Details').click(); kit.count('open details')
        return kit.shot('details')          # returns the PNG path: look at it with Read

    run('<persona>', '<case id>', steps)

run() starts Chromium, logs in the way kit.json says, opens the case, clicks overlays away and
calls steps(page, kit). The session is kept per persona in state_<persona>.json; every run is a
fresh browser, saved data stays in the database. Screenshots go to <kit>/<persona>/NN_<name>.png.

kit.count(step, n=1, search=False) appends to <kit>/<persona>/clicks.jsonl;
`python -P personakit.py tally <persona>` prints the click table for the report.
"""
import json
import os
import re
import sys
from urllib.parse import quote, urlparse

KIT = os.path.dirname(os.path.abspath(__file__))
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')


def load_config(kit=KIT):
    with open(os.path.join(kit, 'kit.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    assert_local(cfg['base_url'])
    return cfg


def assert_local(url):
    """Refuse anything that is not a local development host."""
    host = (urlparse(url).hostname or '').lower()
    if host in LOCAL_HOSTS or host.endswith('.localhost') or host.endswith('.test'):
        return
    raise SystemExit(f'personakit: {url} is not a local host — refusing to run.')


def locate(page, spec):
    """spec is a CSS/Playwright selector string or {"role": ..., "name": <regex>}."""
    if isinstance(spec, dict):
        return page.get_by_role(spec['role'], name=re.compile(spec['name'], re.I))
    return page.locator(spec)


def dismiss(page, cfg, rounds=2):
    """Click away reminders and overlays named in overlay_buttons. Returns how many were clicked."""
    clicked = 0
    for _ in range(rounds):
        for label in cfg.get('overlay_buttons', []):
            try:
                loc = page.get_by_role('button', name=label, exact=True)
                if loc.count() and loc.first.is_visible():
                    loc.first.click()
                    page.wait_for_timeout(400)
                    clicked += 1
            except Exception:
                pass
    return clicked


def case_path(cfg, case_id, path=None):
    return path or cfg['case_path'].format(id=case_id)


def login(page, cfg, next_path):
    """Log in per cfg['login']; leaves the page wherever the app lands."""
    lg = cfg.get('login', {'mode': 'none'})
    mode = lg.get('mode', 'none')
    if mode == 'none':
        return
    if mode == 'url':
        page.goto(cfg['base_url'] + lg['path'].format(next=quote(next_path, safe='/')))
    elif mode == 'form':
        page.goto(cfg['base_url'] + lg['path'].format(next=quote(next_path, safe='/')))
        user, password = os.environ.get(lg['user_env'], ''), os.environ.get(lg['password_env'], '')
        if not user or not password:
            raise SystemExit(f"personakit: set {lg['user_env']} and {lg['password_env']} (test account only).")
        locate(page, lg['user_selector']).fill(user)
        locate(page, lg['password_selector']).fill(password)
        locate(page, lg['submit_selector']).click()
    else:
        raise SystemExit(f'personakit: unknown login mode {mode!r}')
    if lg.get('wait_url'):
        page.wait_for_url(re.compile(lg['wait_url']), timeout=cfg.get('login_timeout_ms', 60000))


def open_page(browser, cfg, state=None):
    w, h = cfg.get('viewport', [1600, 1000])
    ctx = browser.new_context(viewport={'width': w, 'height': h}, locale=cfg.get('locale', 'en-US'),
                              storage_state=state if state and os.path.exists(state) else None)
    page = ctx.new_page()
    page.set_default_timeout(cfg.get('timeout_ms', 15000))
    return ctx, page


def goto_case(page, cfg, target):
    """Open target (a path), logging in first when the app sends us elsewhere."""
    page.goto(cfg['base_url'] + target)
    if cfg.get('login', {}).get('mode', 'none') != 'none' and target not in page.url:
        login(page, cfg, target)
        if target not in page.url:
            page.goto(cfg['base_url'] + target)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(cfg.get('settle_ms', 1500))
    dismiss(page, cfg)


def launch(p, cfg, headless=True):
    exe = cfg.get('browser_executable')
    return p.chromium.launch(headless=headless, **({'executable_path': exe} if exe else {}))


class Kit:
    def __init__(self, page, cfg, out):
        self.page, self.cfg, self.out = page, cfg, out
        self._n = len([f for f in os.listdir(out) if f.endswith('.png')])

    def shot(self, name, full_page=False):
        self._n += 1
        f = os.path.join(self.out, f'{self._n:02d}_{re.sub(r"[^a-zA-Z0-9_-]+", "_", name)}.png')
        self.page.screenshot(path=f, full_page=full_page)
        return f

    def count(self, step, n=1, search=False):
        with open(os.path.join(self.out, 'clicks.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps({'step': step, 'n': n, 'search': search}, ensure_ascii=False) + '\n')

    def dismiss(self):
        return dismiss(self.page, self.cfg)


def run(persona, case_id, steps, path=None, headless=True, kit=KIT):
    from playwright.sync_api import sync_playwright
    cfg = load_config(kit)
    out = os.path.join(kit, persona)
    os.makedirs(out, exist_ok=True)
    state = os.path.join(kit, f'state_{persona}.json')
    with sync_playwright() as p:
        browser = launch(p, cfg, headless)
        ctx, page = open_page(browser, cfg, state)
        try:
            goto_case(page, cfg, case_path(cfg, case_id, path))
            return steps(page, Kit(page, cfg, out))
        finally:
            ctx.storage_state(path=state)
            browser.close()


def tally(persona, kit=KIT):
    """Sum clicks.jsonl per step: {step: [clicks, search]} plus totals."""
    rows, order = {}, []
    with open(os.path.join(kit, persona, 'clicks.jsonl'), encoding='utf-8') as f:
        for line in f:
            e = json.loads(line)
            if e['step'] not in rows:
                rows[e['step']] = [0, 0]
                order.append(e['step'])
            rows[e['step']][0] += e['n']
            if e['search']:
                rows[e['step']][1] += e['n']
    return [(s, *rows[s]) for s in order]


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'tally':
        table = tally(sys.argv[2])
        print('| Step | Clicks | of which search |\n|---|---|---|')
        for s, n, srch in table:
            print(f'| {s} | {n} | {srch} |')
        print(f'| **Total** | **{sum(r[1] for r in table)}** | **{sum(r[2] for r in table)}** |')
    else:
        print(__doc__)
