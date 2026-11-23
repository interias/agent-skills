# Die Skripte von `/mission`

Jedes Skript hat Pester-Tests daneben und Hilfe im Kopfkommentar (`Get-Help <skript> -Detailed`).

- **`worktree.ps1`** rüstet und räumt die Worktrees der Pakete nach dem Adapter: `Up` legt
  Worktree, Env-Dateien, Links der Abhängigkeitsordner und Lock an, `Down` stoppt, was zum Worktree
  gehört, und entfernt ihn, `CleanupStale` räumt ab, was tote Sitzungen hinterlassen haben.
- **`sweep.ps1`** räumt, was über ein einzelnes Repository hinausgeht (siehe unten). `-DryRun`
  zeigt nur, was es täte.
- **`guard.ps1`** ist der PreToolUse-Hook, den `mission`, `mission-aufraeumen` und `kundschafter`
  in ihrem Frontmatter einhängen. Er sperrt je Profil (`epic`, `aufraeumen`, `kundschafter`)
  verbotene Shell-Befehle, etwa Pushes auf den Hauptbranch oder `git branch -D`.
- **`fortsetzen.ps1`** setzt eine `/mission`-Sitzung außerhalb der Flotte mit `claude --resume` fort
  und gibt ihr `guard.ps1` als Hook mit; der Hook aus dem Frontmatter gilt nach `--resume` nicht mehr.
- **`merge.ps1`** dockt einen Pull Request nur bei `merge: nach_gate` im Adapter an, mit gültigem Andockblock
  auf aktueller Basis und Head, grünen Checks und immer mit Andock-Commit. Der Flotten-Treiber ruft
  es auf; ein Lauf nie.
- **`ram.ps1`** misst den freien Speicher des Windows-Hosts und gibt `ok`, `warn` oder `hold`
  aus — die RAM-Bremse vor jedem Paketstart und unter der Flotte.
- **`wecker.ps1`** endet, sobald die Endzeile im Log eines Hintergrundbefehls steht, spätestens nach
  `-Minuten` (höchstens 55). Ein Lauf startet ihn neben langer eigener Hintergrundarbeit, damit sein
  Kontext im warmen Speicher bleibt (#211, `SKILL.md` 4a, „Warm bleiben“).
- **`graph.ps1`** baut mit [Graphify](https://github.com/Graphify-Labs/graphify) den Code-Graphen
  eines Laufs (lokal per AST, ohne Modell) und räumt ihn wieder ab. Optional: Ohne installiertes
  `graphify` (`uv tool install graphifyy`) läuft `/mission` ohne Graph.
- **`usage.ps1`** summiert aus den Transkripten einer Sitzung den Tokenverbrauch eines Laufs je
  Rolle, je Paket und je Agent, auch nachträglich; es liest nur.

## Aufräumen und Speicher

| Was | Wer räumt | Wann |
|---|---|---|
| Worktree, Prozesse und Compose-Projekt eines Pakets, samt der Images, die es gebaut hat | `worktree.ps1 -Action Down` | nach jedem Paket |
| Code-Graph eines Laufs (`.git/epic-graph/epic-<nr>`, rund 15 MB) | `graph.ps1 -Action Remove` | in `/mission-aufraeumen` |
| Worktrees und Prozesse toter Sitzungen | `CleanupStale` | zu Beginn von `/mission` und `/mission-aufraeumen`, je Repository |
| dasselbe über alle Repositorys, dazu alte Temp-Ordner der Läufe, verwaiste WSL-Swap-Dateien, verwaiste Docker-Images, Build-Cache älter als sieben Tage | `sweep.ps1` | am Ende von `/mission-aufraeumen`, oder von Hand |

Von Hand, erst als Probelauf:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\skills\mission\scripts\sweep.ps1" -Root "$HOME\git" -DryRun
```

**Was stehen bleibt und bei dir liegt:** schmutzige Worktrees (sie werden gemeldet, dort kann
Arbeit liegen), Worktrees ohne Lock, die nicht von `Up` stammen, Branches nicht abgenommener
Pakete, Docker-Volumes und markierte Images, Repositorys ohne Adapter-Frontmatter. Die Datei der
WSL-Platte schrumpft nie von selbst, auch wenn innen Platz frei wird.

**Speicher:** Den Arbeitsspeicher treiben die Testläufe, nicht die Worktrees — je Lauf mehrere
Worker, und bis zu drei Pakete plus Orchestrator laufen gleichzeitig. Dagegen stehen die feste
Worker-Zahl im Adapter und die RAM-Bremse.
