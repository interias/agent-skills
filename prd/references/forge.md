# Forge-Zugriff

Welche Forge gilt, steht im Projektadapter (`forge`, `api`). Ohne Adapter wird sie aus
`git remote get-url origin` abgeleitet. Ist das CLI installiert, wird es bevorzugt, denn es kümmert
sich um Auth und Paginierung. Ist es das nicht, geht alles über `curl` gegen die API.

| | CLI | API-Basis | Token |
|---|---|---|---|
| Gitea | `tea` | `<host>/api/v1/repos/<owner>/<repo>` | Header `Authorization: token $TOKEN` |
| GitHub | `gh` | `https://api.github.com/repos/<owner>/<repo>` | `gh auth` oder `Authorization: Bearer $TOKEN` |
| GitLab | `glab` | `<host>/api/v4/projects/<url-encoded-path>` | Header `PRIVATE-TOKEN: $TOKEN` |

Liegt das Token in einer gitignorierten Datei (`token_file`), wird es im Bash-Werkzeug geladen,
nicht im PowerShell-Werkzeug, dort gilt andere Syntax:

```bash
set -a && . <token_file> && set +a
API=http://host:3003/api/v1/repos/Owner/Repo
curl -s -H "Authorization: token $GITEA_TOKEN" "$API/issues/41"
```

## Diese Gitea-Instanz (`mb-vsv-cast:3003`)

Fünf Eigenheiten, die nirgends in einer Konfiguration stehen:

- **Nur englische Schließwörter.** `Closes #n` schließt beim Merge, „Schließt #n" oder „Behebt #n"
  greift nicht. Das gilt für PR-Body und Commit-Nachrichten.
- **Ein Issue mit offenen Blockern lässt sich nicht schließen.** Der Server antwortet mit
  **HTTP 412**. Das fällt erst beim Merge auf, wenn Gitea die `Closes`-Zeilen abarbeitet, nicht
  beim Eröffnen des Pull Requests. Deshalb gehört in den PR-Body, welches geschlossene Issue noch
  offene Blocker hat. Das betrifft auch ein Epic: Die API führt seine Kinder als Blocker. Ob Gitea
  beim Merge die Kinder vor dem Epic schließt, ist nicht belegt. Der PR-Body sagt darum, dass das
  Epic von Hand zu schließen ist, falls es offen bleibt.
- **Listen sind bei 50 Einträgen gedeckelt**, auch wenn `limit` größer gesetzt ist. Mit
  `?limit=50&page=<n>` weiterblättern, bis eine Seite weniger als 50 Einträge liefert.
- **Ein Titel mit `WIP:` macht einen Pull Request zu `draft`.** Das Präfix ist also der Schalter:
  Solange etwas für einen Menschen offen ist, trägt der Titel `WIP: `. Wird der PR fertig, entfernt
  `PATCH /pulls/<nr>` mit neuem `title` das Präfix und damit den Entwurfsstatus.
- **Anonyme Aufrufe liefern 404 statt 401.** Ein 404 auf ein Issue, das es geben muss, heißt
  zuerst: Token fehlt oder ist nicht geladen. Es ist kein Beleg, dass das Issue nicht existiert.

Ohne Token, mit Basic Auth aus dem Git-Credential-Speicher (spill): Zugangsdaten einmal holen und
nie ausgeben.

```bash
CRED=$(printf 'url=http://mb-vsv-cast:3003

' | git credential fill)
GU=$(printf '%s
' "$CRED" | sed -n 's/^username=//p'); GP=$(printf '%s
' "$CRED" | sed -n 's/^password=//p')
curl -s -u "$GU:$GP" "$API/issues/41"
```

## Abhängigkeiten lesen

- **Gitea:** `GET /issues/<nr>/dependencies` liefert die Issues, von denen `<nr>` **blockiert
  wird**. Was eine Kante bedeutet, entscheidet das Label `epic_label` (Standard `epic`) an beiden
  Enden:

  | `<nr>` | blockierendes Issue | Bedeutung |
  |---|---|---|
  | Epic | Epic | **Reihenfolge**: das andere Epic muss vorher fertig sein |
  | Epic | kein Epic | **Kind** des Epics |
  | kein Epic | kein Epic | harter Vorgänger des Kindes |

  Trägt im Repository kein Issue das `epic_label`, gilt jede Kante vom PRD aus als Kind, wie vor
  der Einführung des Labels. Die Lesart gehört in den Plan.
- **GitHub:** kennt keine Issue-Abhängigkeiten. Die Kanten stehen im Body, als Aufgabenlisten des
  PRDs für die Kinder und als Zeilen wie `Blocked by #53` für die harten Kanten. Beides parsen und
  im Plan offenlegen, damit ein Mensch eine Fehldeutung sieht.
- **GitLab:** `GET /issues/<iid>/links` (Typ `blocks` / `is_blocked_by`).

## Abhängigkeiten nachtragen (Gitea)

Mit `write_back_dependencies` trägt der Lauf jede Kante, die er aus `header` oder `body` gelesen
hat, in die Gitea-Abhängigkeiten ein. So sieht jedes Werkzeug, das nur die API liest, denselben
Graphen wie der Lauf.

```
POST /repos/{owner}/{repo}/issues/{index}/dependencies
{"owner": "<owner>", "repo": "<repo>", "index": <nr>}
```

Gelesen wird das so: **`{index}` in der URL ist blockiert von dem Issue im Body.** „#12 wartet auf
#10" ist also `POST …/issues/12/dependencies` mit `"index": 10`. Vertauscht, wartet der Vorgänger
auf seinen Nachfolger.

Vor jedem `POST` prüfen, ob die Kante schon existiert:

```bash
curl -s -H "Authorization: token $GITEA_TOKEN" "$API/issues/12/dependencies" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).some(i=>i.number===10)))'
```

`false` heißt eintragen, `true` heißt überspringen. Jede nachgetragene Kante wird im
Eröffnungskommentar genannt. Eine Kante in ein anderes Repository (`"owner"`/`"repo"` weichen ab)
wird nur eingetragen, wenn die Instanz das annimmt. Lehnt sie ab, steht die Kante weiter nur in
der Kopfzeile, und der Plan sagt das.

## Stolperstellen

- **Paginierung.** Issue-Listen sind serverseitig gedeckelt (Gitea: siehe oben). Immer paginieren,
  nie die erste Seite für die ganze Liste halten.
- **Kommentare und PR-Bodys aus einer Datei schicken, nie aus einer Bash-Zeichenkette.** Beim
  Bauen des JSON-Bodys inline zerlegt die Shell Code-Zäune und Backticks, und zwar still:

  ```bash
  node -e 'fetch(process.argv[1],{method:"POST",headers:{Authorization:"token "+process.env.GITEA_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({body:require("fs").readFileSync(process.argv[2],"utf8")})}).then(r=>r.text()).then(console.log)' \
    "$API/issues/50/comments" bericht.md
  ```

  Mit CLI entfällt der Kunstgriff: `gh issue comment 50 --body-file bericht.md`.

## Nachzählen statt annehmen

Am Ende des Laufs für **jede berührte Nummer** prüfen, dass der Kommentar wirklich ankam. Berührt
sind das PRD bzw. die Spec, jedes Kind, auch jedes übersprungene, und jede transitiv
mitbearbeitete fremde Spec samt ihrer Kinder. Ein `POST` kann fehlgeschlagen sein, ohne dass es
im Lauf auffiel.

```bash
for n in <alle berührten Nummern>; do
  printf "%s " "$n"
  curl -s -H "Authorization: token $GITEA_TOKEN" "$API/issues/$n/comments" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).length))'
done
```

Die Zahl muss je Nummer um die Kommentare dieses Laufs gewachsen sein, gemessen am Stand vor dem
Eröffnungskommentar.

## Pull Request

Der Body geht denselben Weg wie ein Kommentar, aus einer Datei:

```bash
node -e 'const[u,h,b,t,f]=process.argv.slice(1);fetch(u,{method:"POST",headers:{Authorization:"token "+process.env.GITEA_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({head:h,base:b,title:t,body:require("fs").readFileSync(f,"utf8")})}).then(r=>r.text()).then(console.log)' \
  "$API/pulls" "epic/41-…" "<base_branch>" "WIP: …" pr.md
```

GitHub: `gh pr create --base <base_branch> --head epic/… --title "…" --body-file pr.md`.
