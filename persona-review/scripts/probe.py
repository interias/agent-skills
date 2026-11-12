"""Acceptance probe: open, wait, leave unchanged — with a counter-probe. Local test instances only.

    python -P probe.py <kit dir> <case id>[,<case id>...] <out.json>

Per case, each in a fresh browser context (config: kit.json, key "probe"):
  quiet   open, wait probe.wait_ms, click overlays away, click probe.leave.
          Expect: no guard dialog, and the page was really left.
  close   open, wait, close the tab with beforeunload. Expect: no native dialog.
  counter open, wait, type into probe.change_selector, click probe.leave.
          Expect: the guard dialog shows and the page stays.

Verdict per case:
  ok          quiet and close pass, counter fires
  finding     counter fires, but quiet or close raised a guard: a real finding
  deaf        counter did not fire: the probe cannot hear a guard, its quiet result means nothing
  not_left    quiet raised no guard but stayed on the page: a click was swallowed (overlay?)
Exit code: 0 all ok, 1 a finding, 2 a deaf or not_left case.

The counter-probe types into a real field and never saves; run it on synthetic cases only.
If the app autosaves, the typed character is saved — pick a field where that does no harm.
"""
import json
import os
import sys


def leave(page, cfg, target):
    from personakit import locate
    pr = cfg['probe']
    try:
        locate(page, pr['leave']).first.click()
    except Exception:  # an overlay that intercepts the click makes Playwright time out
        pass
    page.wait_for_timeout(pr.get('after_leave_ms', 2500))
    guard = page.locator(pr.get('guard_selector', '[role=alertdialog]'))
    shown = guard.count() > 0 and guard.first.is_visible()
    return shown, target not in page.url


def probe_case(browser, cfg, case_id):
    from personakit import case_path, dismiss, goto_case, open_page
    pr, target = cfg['probe'], case_path(cfg, case_id)

    def fresh():
        ctx, page = open_page(browser, cfg)
        goto_case(page, cfg, target)
        page.wait_for_timeout(pr.get('wait_ms', 10000))
        dismiss(page, cfg)
        return ctx, page

    ctx, page = fresh()
    quiet_guard, quiet_left = leave(page, cfg, target)
    ctx.close()

    ctx, page = fresh()
    native = []
    page.on('dialog', lambda d: (native.append(d.type), d.dismiss()))
    pump = ctx.new_page()  # keeps the event loop turning while the probed page closes
    page.close(run_before_unload=True)
    pump.wait_for_timeout(1500)
    ctx.close()

    ctx, page = fresh()
    box = page.locator(pr['change_selector']).first
    try:
        box.click()
        box.press('End')
        box.type(pr.get('change_text', 'x'))
    except Exception:  # the change did not land: the counter cannot fire, the verdict is deaf
        pass
    page.wait_for_timeout(1500)
    counter_guard, counter_left = leave(page, cfg, target)
    ctx.close()

    if not counter_guard:
        verdict = 'deaf'
    elif not quiet_guard and not quiet_left:
        verdict = 'not_left'
    elif quiet_guard or native:
        verdict = 'finding'
    else:
        verdict = 'ok'
    return {'id': case_id, 'verdict': verdict,
            'quiet': {'guard': quiet_guard, 'left': quiet_left},
            'close': {'native_dialogs': native},
            'counter': {'guard': counter_guard, 'left': counter_left}}


def main(kit, ids, out):
    sys.path.insert(0, os.path.abspath(kit))
    from playwright.sync_api import sync_playwright
    from personakit import launch, load_config
    cfg = load_config(kit)
    results = []
    with sync_playwright() as p:
        browser = launch(p, cfg)
        for case_id in ids:
            r = probe_case(browser, cfg, case_id)
            results.append(r)
            print(json.dumps(r, ensure_ascii=False), flush=True)
        browser.close()
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    verdicts = {r['verdict'] for r in results}
    return 2 if verdicts & {'deaf', 'not_left'} else 1 if 'finding' in verdicts else 0


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2].split(','), sys.argv[3]))
