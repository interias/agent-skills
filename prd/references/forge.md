# Forge-Zugriff

Welche Forge gilt, steht im Projektadapter; ohne Adapter aus `git remote get-url origin`
ableiten. Bevorzugt das CLI, wenn es installiert ist — es kümmert sich um Auth und Paginierung.
Ist es das nicht, geht alles über `curl` gegen die API.

| | CLI | API-Basis | Token |
|---|---|---|---|
| Gitea | `tea` | `<host>/api/v1/repos/<owner>/<repo>` | Header `Authorization: token $TOKEN` |
| GitHub | `gh` | `https://api.github.com/repos/<owner>/<repo>` | `gh auth` oder `Authorization: Bearer $TOKEN` |
| GitLab | `glab` | `<host>/api/v4/projects/<url-encoded-path>` | Header `PRIVATE-TOKEN: $TOKEN` |

Liegt das Token in einer gitignorierten Datei (Adapterschlüssel `token_file`), im Bash-Werkzeug
laden — nicht im PowerShell-Werkzeug, dort gilt andere Syntax:

```bash
set -a && . .sandcastle/.env && set +a
API=http://host:3003/api/v1/repos/Owner/Repo
curl -s -H "Authorization: token $GITEA_TOKEN" "$API/issues/41"
```

## Abhängigkeiten lesen

- **Gitea:** `GET /issues/<nr>/dependencies` liefert die Issues, von denen `<nr>` **blockiert
  wird**. Für ein PRD sind das seine Kinder, für ein Kind seine Vorgänger.
- **GitHub:** kennt keine Issue-Abhängigkeiten. Die Kanten stehen im Body — Aufgabenlisten des
  PRDs für die Kinder, Zeilen wie `Blocked by #53` für die harten Kanten. Beides parsen und im
  Plan offenlegen, damit ein Mensch eine Fehldeutung sieht.
- **GitLab:** `GET /issues/<iid>/links` (Typ `blocks` / `is_blocked_by`).

## Stolperstellen

- **Paginierung.** Issue-Listen sind serverseitig gedeckelt (Gitea: 50). Immer paginieren, nie
  die erste Seite für die ganze Liste halten.
- **Kommentare aus einer Datei schicken, nie aus einer Bash-Zeichenkette.** Beim Bauen des
  JSON-Bodys inline zerlegt die Shell Code-Zäune und Backticks, und zwar still:

  ```bash
  node -e 'fetch(process.argv[1],{method:"POST",headers:{Authorization:"token "+process.env.GITEA_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({body:require("fs").readFileSync(process.argv[2],"utf8")})}).then(r=>r.text()).then(console.log)' \
    "$API/issues/50/comments" bericht.md
  ```

  Mit CLI entfällt der Kunstgriff: `gh issue comment 50 --body-file bericht.md`.

## Nachzählen statt annehmen

Am Ende des Laufs für jede berührte Nummer prüfen, dass der Kommentar wirklich ankam:

```bash
for n in <alle berührten Nummern>; do
  printf "%s " "$n"
  curl -s -H "Authorization: token $GITEA_TOKEN" "$API/issues/$n/comments" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).length))'
done
```

## Pull Request

```bash
curl -s -X POST -H "Authorization: token $GITEA_TOKEN" -H "Content-Type: application/json" \
  -d '{"head":"epic/41-…","base":"main","title":"…","body":"…"}' "$API/pulls"
```

Bei langem Body denselben Weg über eine Datei nehmen wie beim Kommentar. GitHub:
`gh pr create --base main --head epic/… --title "…" --body-file pr.md`.
