# `/leitstand` für Menschen

Die Hauptsitzung (Claude Desktop, Konto 1) steuert damit Sitzungen des zweiten Kontos, die in
eigenen Terminalfenstern arbeiten: Aufträge starten, Meldungen behandeln, PRs nach dem Adapter
mergen, aufräumen und dir knapp berichten. Der Leitstand arbeitet selbst nicht im Code. Die
Anweisungen an den Agenten stehen in [`SKILL.md`](SKILL.md), eingerichtet wird das zweite Konto
nach [`../README.md`](../README.md).

- **Aufruf:** nur in der Hauptsitzung, nie im Arbeitspferd. `/leitstand` zeigt die Lage; mit
  Argument startet er direkt, etwa `/leitstand epic <repo> 42`, `/leitstand flotte <repo>` oder
  `/leitstand issues <repo> <Ziel>`.
- **Aufträge** (Modi `epic`, `flotte`, `nacharbeit`, `aufraeumen`, `issues`) schreibt er als Datei;
  `start.ps1` öffnet dafür ein Fenster mit festem Titel und hängt die
  [Flottenregeln](references/flotten-regeln.md) an. Die Sitzung meldet sich nur mit Zeilen
  `LEITSTAND: PR #n bereit`, `FRAGE`, `BLOCKIERT` oder `FERTIG`.
- **Ein Wächter** (`waechter.ps1`) beobachtet alle Fenster und meldet sich nur, wenn der Leitstand
  handeln muss. Nachrichten an eine laufende Sitzung stellt `nachricht.ps1` ohne Neustart zu.
- **Mergen:** nur mit `merge.ps1` und nur bei `merge: nach_gate` im Adapter, nach grünen Checks und
  gültigem Gate-Block, immer mit Merge-Commit. Bei `merge: mensch` meldet er dir „PR bereit“, und
  du mergst. Die Sitzungen im Fenster mergen nie.
- **Gedächtnis:** `lagebuch.md` und `register.json` unter `~/.claude-arbeitspferd/leitstand/`;
  Regeln nur für deinen Rechner in `lokal.md` daneben, nicht im Repository.
- **Bei dir:** Erlaubnisfragen im Fenster (der Leitstand tippt nie hinein), Sicherheits-, Zugriffs-
  und Produktrichtungsfragen und das Mergen bei `merge: mensch`.

Der Leitstand kennt nur Konto 2. Weitere Konten arbeiten nur unter dem
[Flotten-Treiber](../../flotte/README.md).
