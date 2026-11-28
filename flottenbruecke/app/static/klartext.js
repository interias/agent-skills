// The Klartext display (#246, agent-skills/ADR-0008): the bridge speaks the Sprachraum by default; a device may switch
// to the usual developer terms. A display only: the areas keep drawing in the Sprachraum, this file changes what the
// page shows afterwards, text nodes and the attributes a person reads (aria-label, title, placeholder, alt), and gives
// the originals back when the device switches back. Every plain term stands in the term table klartext.json, also
// read by the push (app/klartext.py):
//
//   texte   the second version of a fixed text, looked up whole ({} stands for a part that comes by word forms)
//   formen  word forms with article and case for the texts of the driver and the runs, longest first
//   muster  separable verbs ("dockt erst an")
//
// Never replaced: what stands in [translate="no"] (titles, answers, chat, project names, drafts), code, pre, kbd,
// textarea, and inside a text code in backticks, links and paths. The name "Flottenbrücke" stays (it is no term of
// the left column).
//
// Per device: a paired device keeps its choice in the bridge (POST /api/geraete/anzeige, the board names it in
// t.geraet.anzeige), so the push speaks it too; a device not paired keeps it in this browser. A choice made before
// pairing goes to the bridge with the first board that names the device.
'use strict';

const klartext = (() => {
  const LAGER = 'flottenbruecke-anzeige';
  const EIGEN = 'flottenbruecke-anzeige-ungekoppelt';
  const lager = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
    weg(k) { try { localStorage.removeItem(k); } catch { /* private window */ } },
  };
  const ATTRIBUTE = ['aria-label', 'title', 'placeholder', 'alt', 'aria-description'];
  const NIE = '[translate="no"], code, pre, kbd, samp, script, style, textarea';
  const GESCHUETZT = /`[^`]*`|https?:\/\/\S+|\S*[/\\]\S*/g;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const gross = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  let modus = lager.get(LAGER) === 'klartext' ? 'klartext' : 'sprachraum';
  let tab = null;
  let stand = null;
  const lauscher = [];
  // what this page changed: text node -> { roh, klar }; element -> Map(attribute -> { roh, klar })
  const knoten = new WeakMap();
  const attribute = new WeakMap();
  // for the tests: every text the page replaced, and how (fassung or formen)
  const protokoll = [];

  function baue(t) {
    const formen = new Map(t.formen);
    for (const [s, k] of t.formen) if (/^\p{Ll}/u.test(s) && !formen.has(gross(s))) formen.set(gross(s), gross(k));
    const alle = [...formen.keys()].sort((a, b) => b.length - a.length);
    const fest = new Map();
    const mit = [];
    for (const [s, k] of Object.entries(t.texte)) {
      if (s.includes('{}')) mit.push([new RegExp(`^${esc(s).replace(/\\\{\\\}/g, '(.*?)')}$`, 'u'), k]);
      else fest.set(s, k);
    }
    const links = t.begriffe.filter(([s, k]) => s !== k).map(([s]) => s);
    const staemme = [...new Set([...links.flatMap((s) => s.split(' ')).filter((w) => w !== 'frei' && w !== 'Erster'), 'Außeneinsätz', 'Offizier', 'Andock', 'andock', 'angedockt', 'dockt', 'docken', 'dockte', 'Schnittpläne'])].sort((a, b) => b.length - a.length);
    return {
      begriffe: t.begriffe,
      formen,
      form: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alle.map((s) => esc(s) + (s.endsWith('-') ? '' : '(?![\\p{L}\\p{N}])')).join('|')})`, 'gu'),
      muster: t.muster.map(([m, e]) => [new RegExp(m, 'g'), e]),
      fest,
      mit,
      sprachraum: new RegExp(`(?<![\\p{L}\\p{N}])(?:${staemme.map(esc).join('|')})`, 'u'),
    };
  }

  // ---- replacing

  function stueck(t) {
    for (const [m, e] of tab.muster) t = t.replace(m, (...g) => e.replace(/\$(\d)/g, (_, i) => g[Number(i)] ?? ''));
    return t.replace(tab.form, (w) => tab.formen.get(w));
  }

  // a text of the driver or a run: word forms, code, links and paths untouched
  function ersetze(text) {
    if (!tab) return text;
    let aus = '';
    let pos = 0;
    for (const g of text.matchAll(GESCHUETZT)) {
      aus += stueck(text.slice(pos, g.index)) + g[0];
      pos = g.index + g[0].length;
    }
    return aus + stueck(text.slice(pos));
  }

  // the second version of a fixed text, or null; {} stands for a part that comes by word forms
  function fassung(text) {
    if (!tab) return null;
    const t = text.trim().split(/\s+/).join(' ');
    if (tab.fest.has(t)) return tab.fest.get(t);
    for (const [m, k] of tab.mit) {
      const x = m.exec(t);
      if (x) {
        let i = 1;
        return k.replace(/\{\}/g, () => ersetze(x[i++]));
      }
    }
    return null;
  }

  const sprachraumIn = (text) => Boolean(tab) && text.replace(GESCHUETZT, ' ').search(tab.sprachraum) >= 0;

  // one text as the page shows it in Klartext; the white space around stays, soft hyphens fall away when it changes
  function klar(roh) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(roh);
    const kern = m[2].replace(/­/g, '');
    if (!kern) return roh;
    const f = fassung(kern);
    if (f != null) {
      protokoll.push({ roh: kern, klar: f, wie: 'fassung' });
      return m[1] + f + m[3];
    }
    if (!sprachraumIn(kern)) return roh;
    const k = ersetze(kern);
    protokoll.push({ roh: kern, klar: k, wie: 'formen' });
    return m[1] + k + m[3];
  }

  // ---- the page

  const nie = (el) => !el || Boolean(el.closest(NIE));

  function textKnoten(n) {
    const e = knoten.get(n);
    if (e && n.data === e.klar) {
      if (modus === 'sprachraum') { n.data = e.roh; knoten.delete(n); }
      return;
    }
    if (e) knoten.delete(n); // drawn anew in the meantime: what stands there is the original
    if (modus !== 'klartext' || nie(n.parentElement)) return;
    const k = klar(n.data);
    if (k !== n.data) {
      knoten.set(n, { roh: n.data, klar: k });
      n.data = k;
    }
  }

  function attribut(el, name) {
    const je = attribute.get(el);
    const e = je?.get(name);
    const wert = el.getAttribute(name);
    if (e && wert === e.klar) {
      if (modus === 'sprachraum') { el.setAttribute(name, e.roh); je.delete(name); }
      return;
    }
    if (e) je.delete(name);
    if (modus !== 'klartext' || wert == null || nie(el)) return;
    const k = klar(wert);
    if (k === wert) return;
    if (!attribute.has(el)) attribute.set(el, new Map());
    attribute.get(el).set(name, { roh: wert, klar: k });
    el.setAttribute(name, k);
  }

  function gehe(wurzel) {
    if (!tab) return;
    if (wurzel.nodeType === Node.TEXT_NODE) return textKnoten(wurzel);
    if (wurzel.nodeType !== Node.ELEMENT_NODE) return;
    const w = document.createTreeWalker(wurzel, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) textKnoten(n);
      else for (const a of ATTRIBUTE) if (n.hasAttribute(a)) attribut(n, a);
    }
  }

  const beobachter = new MutationObserver((liste) => {
    for (const m of liste) {
      if (m.type === 'childList') m.addedNodes.forEach(gehe);
      else if (m.type === 'characterData') textKnoten(m.target);
      else attribut(m.target, m.attributeName);
    }
  });

  function anwenden() {
    gehe(document.body);
    document.documentElement.dataset.anzeige = modus;
    for (const f of lauscher) {
      try { f(modus); } catch (err) { console.error(err); }
    }
  }

  // ---- the switch

  // the board after each load (huelle.beiTafel): a paired device follows the bridge
  function tafel(t) {
    stand = t;
    if (!t.geraet) return;
    if (lager.get(EIGEN)) {
      lager.weg(EIGEN);
      if ((t.geraet.anzeige ?? 'sprachraum') !== modus) {
        setzen(modus);
        return;
      }
    }
    const neu = t.geraet.anzeige === 'klartext' ? 'klartext' : 'sprachraum';
    if (neu === modus) return;
    modus = neu;
    lager.set(LAGER, modus);
    anwenden();
  }

  // a choice of the person; true when it holds
  async function setzen(neu) {
    if (neu !== 'klartext' && neu !== 'sprachraum') return false;
    if (stand?.geraet) {
      const r = await fetch('/api/geraete/anzeige', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anzeige: neu }) }).catch(() => null);
      if (!r?.ok) return false;
      stand.geraet.anzeige = neu;
      lager.weg(EIGEN);
    } else {
      lager.set(EIGEN, '1');
    }
    modus = neu;
    lager.set(LAGER, modus);
    anwenden();
    return true;
  }

  fetch('/static/klartext.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then((t) => {
      tab = baue(t);
      beobachter.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTE });
      anwenden();
    })
    .catch((err) => console.error('Klartext: Begriffstabelle nicht geladen', err));
  addEventListener('DOMContentLoaded', () => huelle.beiTafel(tafel));

  return {
    modus: () => modus,
    setzen,
    gekoppelt: () => Boolean(stand?.geraet),
    beiWechsel: (f) => lauscher.push(f),
    bereit: () => Boolean(tab),
    ersetze,
    fassung,
    sprachraumIn,
    // for the search: a text in both vocabularies, whatever the display
    beide: (s) => { const t = String(s ?? ''); return tab ? `${t} ${fassung(t) ?? ersetze(t)}` : t; },
    protokoll,
  };
})();
