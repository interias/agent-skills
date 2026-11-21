# Die Skripte von `/epic`

Jedes Skript hat Pester-Tests daneben und Hilfe im Kopfkommentar (`Get-Help <skript> -Detailed`).

- **`worktree.ps1`** rüstet und räumt die Worktrees der Pakete nach dem Adapter: `Up` legt
  Worktree, Env-Dateien, Links der Abhängigkeitsordner und Lock an, `Down` stoppt, was zum Worktree
  gehört, und entfernt ihn, `CleanupStale` räumt ab, was tote Sitzungen hinterlassen haben.
- **`sweep.ps1`** räumt, was über ein einzelnes Repository hinausgeht (siehe unten). `-DryRun`
  zeigt nur, was es täte.
- **`guard.ps1`** ist der PreToolUse-Hook, den `epic`, `epic-aufraeumen` und `epic-kundschafter`
  in ihrem Frontmatter einhängen. Er sperrt je Profil (`epic`, `aufraeumen`, `kundschafter`)
  verbotene Shell-Befehle, etwa Pushes auf den Hauptbranch oder `git branch -D`.
- **`testausgabe.ps1`** ist der zweite PreToolUse-Hook von `epic` und der Implementer- und
  Reviewer-Agenten: Ein Testbefehl aus `test_commands` oder `test_commands_affected` des Adapters
  schreibt seine Ausgabe in einen Log unter `<temp>/epic-testausgabe`; in den Kontext kommen nur
  Fehlerzeilen, Schluss und Log-Pfad. Er sperrt nichts und gibt keine Freigabe: Die Berechtigungen
  prüfen den umgeschriebenen Befehl. Steht im Fenster eine Erlaubnisregel nur für den nackten
  Testbefehl, fragt Claude Code für die umgeschriebene Form nach.
- **`reviewpaket.ps1`** schreibt das Review-Paket eines Pakets (Statistik, Diff, neue Dateien) in
  `<git dir>/epic-review/`; mit `-Since` nur den Fix-Diff für den Nach-Review.
- **`fortsetzen.ps1`** setzt eine `/epic`-Sitzung außerhalb der Flotte mit `claude --resume` fort
  und gibt ihr `guard.ps1` und `testausgabe.ps1` als Hooks mit; die Hooks aus dem Frontmatter gelten
  nach `--resume` nicht mehr.
- **`ram.ps1`** misst den freien Speicher des Windows-Hosts und gibt `ok`, `warn` oder `hold`
  aus — die RAM-Bremse vor jedem Paketstart und unter der Flotte.
- **`graph.ps1`** baut mit [Graphify](https://github.com/Graphify-Labs/graphify) den Code-Graphen
  eines Laufs (lokal per AST, ohne Modell) und räumt ihn wieder ab. Optional: Ohne installiertes
  `graphify` (`uv tool install graphifyy`) läuft `/epic` ohne Graph.
- **`usage.ps1`** summiert aus den Transkripten einer Sitzung den Tokenverbrauch eines Laufs je
  Rolle, je Paket und je Agent, auch nachträglich; es liest nur.

## Aufräumen und Speicher

| Was | Wer räumt | Wann |
|---|---|---|
| Worktree, Prozesse und Compose-Projekt eines Pakets, samt der Images, die es gebaut hat | `worktree.ps1 -Action Down` | nach jedem Paket |
| Code-Graph eines Laufs (`.git/epic-graph/epic-<nr>`, rund 15 MB) | `graph.ps1 -Action Remove` | in `/epic-aufraeumen` |
| Worktrees und Prozesse toter Sitzungen | `CleanupStale` | zu Beginn von `/epic` und `/epic-aufraeumen`, je Repository |
| dasselbe über alle Repositorys, dazu alte Temp-Ordner der Läufe, verwaiste WSL-Swap-Dateien, verwaiste Docker-Images, Build-Cache älter als sieben Tage | `sweep.ps1` | am Ende von `/epic-aufraeumen`, oder von Hand |

Von Hand, erst als Probelauf:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\skills\epic\scripts\sweep.ps1" -Root "$HOME\git" -DryRun
```

**Was stehen bleibt und bei dir liegt:** schmutzige Worktrees (sie werden gemeldet, dort kann
Arbeit liegen), Worktrees ohne Lock, die nicht von `Up` stammen, Branches nicht abgenommener
Pakete, Docker-Volumes und markierte Images, Repositorys ohne Adapter-Frontmatter. Die Datei der
WSL-Platte schrumpft nie von selbst, auch wenn innen Platz frei wird.

**Speicher:** Den Arbeitsspeicher treiben die Testläufe, nicht die Worktrees — je Lauf mehrere
Worker, und bis zu drei Pakete plus Orchestrator laufen gleichzeitig. Dagegen stehen die feste
Worker-Zahl im Adapter und die RAM-Bremse.
