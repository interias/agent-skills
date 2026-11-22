# Quellen

Woher Ideen, Wortlaut und Werkzeuge dieses Repositorys stammen: je Quelle Link, Lizenz und was
übernommen wurde. Lizenzen sind an der Quelle nachgelesen (Stand 22.11.2026).

## mattpocock/skills

- **Link:** <https://github.com/mattpocock/skills>
- **Lizenz:** MIT. Copyright (c) 2026 Matt Pocock.
- **Abgeleitet** (folgen ihren Vorbildern Absatz für Absatz, sind also Ableitungen):
  `codebase-design` und `prototype`.
- **Nur Ideen übernommen** (eigener Text, eigener Aufbau): `tdd`, `diagnosing-bugs`,
  `code-inspektion` und `research`.
- Das Plugin selbst ist keine Abhängigkeit mehr
  ([ADR-0001](docs/adr/0001-eigene-skills-statt-pocock.md)); wie man es entfernt, steht in
  [`INSTALL.md`](INSTALL.md).

Lizenzhinweis, den die MIT-Lizenz für wesentliche Teile verlangt:

> MIT License
>
> Copyright (c) 2026 Matt Pocock
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## DietrichGebert/ponytail

- **Link:** <https://github.com/DietrichGebert/ponytail>
- **Lizenz:** MIT. Copyright (c) 2026 DietrichGebert.
- **Übernommen:** die Leiter „kleinste vollständige Änderung“ in den Implementer-Agenten
  (`agents/epic-implementer-*.md`) und die Befundform Muss, Sollte, Kann (nach `ponytail-review`)
  in den Reviewer-Agenten (`agents/epic-reviewer-*.md`).

## Graphify-Labs/graphify

- **Link:** <https://github.com/Graphify-Labs/graphify>
- **Lizenz:** Apache-2.0.
- **Genutzt, nicht übernommen:** ein lokal installiertes Werkzeug (`uv tool install graphifyy`),
  das `epic/scripts/graph.ps1` aufruft, um den Code-Graphen eines Laufs zu bauen. Kein Code aus
  dem Repository liegt hier.

## Noch nachzutragen

Diese Quellen sind im Repository nicht belegt; Link und Lizenz fehlen, bis jemand sie an der
Quelle klärt:

- die Repositorys der Skill-Recherche (aus der die eigenen Skills hervorgingen),
- die Vorbilder der Flottenbrücke.
