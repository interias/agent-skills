---
name: code-inspektion
description: Als Erster Offizier abnehmen, was ein Ingenieur gebaut hat — ob in einem Missionsziel oder in einem einzelnen Commit. Erst ob das Verlangte dasteht, dann ob es nach den Regeln des Projekts gebaut ist; was fehlt, kommt als Muss, Sollte oder Kann zurück.
---

# Code-Inspektion

Eine Inspektion beantwortet zwei Fragen, die man nicht vermischt: **Wurde gebaut, was verlangt
war?** und **Ist es so gebaut, wie das Projekt es verlangt?** Wer beides in einem Atemzug prüft,
lässt eine Achse durchrutschen. Dieser Skill gilt für jede Änderung seit einem Commit oder Zweig,
in einer Mission (`/epic`, Phase 4b) und außerhalb.

Die **Befundform** (Muss, Sollte, Kann, Fundstelle, Fall, kleinste Korrektur, Urteilszeile) steht in
`agents/epic-reviewer-standard.md` und `-urteil.md`; sie gilt hier unverändert. Dieser Skill sagt,
**wie du zu den Befunden kommst**.

## 1. Den Maßstab festlegen

Bevor du ein Wort Code liest, schreib auf, wogegen du prüfst:

- **Für die Spec-Achse:** die Abnahmeliste im Wortlaut (Missionsziel, Issue, Auftrag), die
  Implementation Decisions mit Begründung und die Out-of-Scope-Punkte. Gibt es keine, frag nach
  dem Auftrag der Änderung oder leite ihn aus der Commit-Nachricht ab und sag, dass du es getan hast.
- **Für die Standards-Achse:** die Projektregeln (`CONTEXT.md`, Adapter, ADRs im berührten Bereich,
  Lint- und Testkonfiguration) und der Stil des umgebenden Codes.

## 2. Die Änderung vollständig sehen

- **Gegen den eigenen Startpunkt diffen, nicht gegen einen Zweig.** In einem Worktree ist das
  `git diff HEAD`: Ein Diff gegen den Missionszweig zeigt inzwischen angedockte Pakete als
  vermeintliche Änderung, und du suchst Fehler in fremdem Code. Außerhalb eines Worktrees nimmst du
  den gemeinsamen Vorfahren mit dem Zweig, den der Mensch nennt: `git diff <Zweig>...HEAD`
  (drei Punkte, das ist der Vergleich gegen `git merge-base`).
- **Neue Dateien stehen in keinem Diff.** Hol sie mit `git status` oder `git ls-files --others
  --exclude-standard` und lies sie ganz. Eine neue Kernfunktion, die du nie siehst, nimmst du
  ungeprüft ab.
- **Lies nicht nur Zeilen, die sich geändert haben.** Wer die Signatur änderte, hat Aufrufer, Tests
  und Fixtures berührt oder hätte sie berühren müssen: Such sie mit `grep` auf den Namen.

## 3. Spec-Achse

Gehe die Abnahmeliste Punkt für Punkt durch, und zwar mit **Nachweis, nicht Behauptung**: Findest
du den Punkt im Code, in einem Test, in einer Ausgabe? „Der Bericht sagt, es geht“ ist kein Beleg.
Dazu drei Gegenfragen:

- Wurde etwas gebaut, das niemand verlangt hat?
- Ist ein Out-of-Scope-Punkt verletzt?
- Ist eine Decision umgangen, weil die naheliegende Lösung bequemer war? (Lies die Begründung der
  Decision, bevor du urteilst.)

## 4. Standards-Achse

Fachsprache und Verbote aus `CONTEXT.md`; kein toter oder auskommentierter Rest; keine ADR-Verletzung;
Tests entlang des Verifikationswegs und in der Form der Nachbarn; keine neue Abhängigkeit ohne
Nennung im Auftrag; die Lint-Basis: Meldet das Werkzeug mehr als beim Start, ist die Differenz ein
Befund.

## 5. Wächter und Schreibschutz: Probe und Gegenprobe

- **Ein Wächter, ein Tor, ein Filter** wird gegen sich selbst geprüft. Die **Positivprobe** zeigt,
  dass er das Falsche stoppt; die **Gegenprobe** zeigt, dass er das Richtige durchlässt. Ein Wächter,
  der nur in einer Richtung belegt ist, gilt als ungeprüft.
- **Schreibsperre, Update-Schutz, neue Validierung:** Such **jeden anderen Schreiber derselben
  Felder**: Migration, Import, Skripte, Hintergrundjobs, andere Endpunkte, die Pfade aus `writers`
  im Adapter. Je Schreiber belegst du, dass er durchkommt, oder meldest ihn als Befund. Was nur ein
  Trockenlauf abdeckt, ist nicht geprüft, denn der sieht die schreibenden Aufrufe nicht.

## 6. Läufe und Zahlen

Du fährst **keinen Volllauf**, nur gezielt die betroffenen Tests und deine Gegenproben. Zahlen und
Protokoll des Ingenieurs prüfst du gegen die **Ausgangszahlen**: Gesunkene Testzahl bei grüner Suite
ist ein Befund. Rot in Dateien, die die Änderung nicht berührt, und einzeln grün, ist eine
Lastflake; vermerken, kein Befund.

## 7. Berichten

- **Kein konkreter Fall, kein Befund.** Lies die Stelle noch einmal, bevor du sie meldest.
- **Nur Muss löst eine neue Runde aus.** Ein Muss, das die Bauweise selbst trifft, nennst du
  *strukturell*; es löst die Eskalation aus.
- **Kleines korrigierst du selbst** (Benennung, Kommentar, ein fehlender Testfall, ein vergessener
  Rest) und nennst es im Bericht. **Strukturelles und Größeres berichtest du nur**, korrigierst es
  nicht.
- **Funde außerhalb der Änderung** (ein Fehler in angrenzendem Code, ein Fehler, der schon vorher
  da war) stehen nur im Bericht, ohne Ticket und ohne Korrektur.
- **Ehrlich enden:** Was du nicht prüfen konntest, steht in der Zeile `Nicht geprüft: …`.
