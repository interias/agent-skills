// The orders of `flotte mission` (#69, stage 3, decision 3): the program writes each language-model
// call's order from the fields of the cut, in the wording and with the content of mission/SKILL.md
// (cut: Phase 1 and 2a–2c; implementer: 4a; reviewer: 4b; conflict: Phase 5), and the commit of 4d
// after the adapter. The agent files under agents/ stay the instruction (`claude -p --agent`); the
// order carries what the agent has no other way to know. Every rule is quoted with where it comes from.

import { frontmatter } from '../werkzeuge/belegung.ts';
import { karte } from './mechanik.ts';
import { IMPLEMENTER, REVIEWER } from './regeln.ts';
import type { Paket } from './schema.ts';
import type { PaketZustand, Testlauf } from './zustand.ts';

export interface Kontext {
  epic: number;
  epicBranch: string;
  epicWorktree: string;
  /** .claude/epic.md of the target repository, '' when it is missing */
  adapter: string;
  /** graph.json of the code graph (Phase 0b), null when none was built */
  graph: string | null;
  /** Ausgangszahlen and lint findings per file of phase 0 */
  basis: Testlauf;
  basisLint: Record<string, number>;
  /** pre_commit_checks without a program at their start: the program does not run them, the Ingenieur keeps them (#108) */
  vorCommitProsa?: string[];
}

const liste = (titel: string, punkte: string[], leer = 'keine') => `${titel}\n${punkte.length ? punkte.map((x) => `- ${x}`).join('\n') : `- ${leer}`}`;

function adapterWerte(k: Kontext) {
  const f = frontmatter(k.adapter);
  const eins = (n: string) => f.get(n)?.[0] ?? null;
  return {
    glossary: eins('glossary') ?? 'CONTEXT.md',
    marker: eins('glossary_forbidden_marker') ?? '_Avoid_',
    mustRead: f.get('must_read') ?? null,
    adrDir: eins('adr_dir') ?? 'docs/adr',
    alleAdrs: eins('read_all_adrs') === 'true',
    outOfScopeDir: eins('out_of_scope_dir'),
    darfStarten: f.get('worktree_may_start') ?? ['dev_server'],
    isolationEnv: eins('test_isolation_env'),
    tests: karte(k.adapter, 'test_commands') ?? {},
    stil: eins('commit_style'),
    sprache: eins('commit_language'),
    umlaute: eins('commit_umlauts'),
  };
}

export const zahlen = (t: Testlauf) => t.map((s) => `${s.name} ${s.tests} Tests in ${s.dateien ?? '?'} Dateien, ${s.rot.length} rot${s.rot.length ? ` (${s.rot.map((r) => `${r.datei}: ${r.test}`).join('; ')})` : ''}`).join('; ') || 'keine';

/** mission/SKILL.md 4a, the code graph: path, the three queries word for word, the rule */
function graphText(k: Kontext, p: Paket): string {
  if (!k.graph) return 'Code-Graph: keiner gebaut (Graphify fehlt oder der Adapter schaltet ihn ab, `code_graph: off`). Du suchst gezielt mit Grep und Glob, immer mit `path`.';
  const g = k.graph;
  return [
    `Code-Graph (Stand des Missions-Kopfs beim Paketstart, nicht deine eigenen Änderungen): \`${g}\``,
    `- \`graphify explain "<symbol oder datei>" --graph ${g}\` — Nachbarn mit Datei und Zeile`,
    `- \`graphify affected "<symbol oder datei>" --depth 1 --graph ${g}\` — wer davon abhängt`,
    `- \`graphify path "<A>" "<B>" --graph ${g}\``,
    'Exit 3 heißt mehrdeutig (die Kandidaten stehen da; mit der genannten ID wiederholen), Exit 4 kein Treffer.',
    '**Erst den Graphen fragen, dann gezielt die genannten Stellen lesen**, statt den Baum zu durchsuchen. Aufrufer in Tests können im Graphen fehlen: Die Liste der Stellen, die die Änderung erreichen muss, schließt deshalb mit einem gezielten `grep` auf den Symbolnamen.',
    `Berührte Dateien samt ihrer Abhängigen aus dem Schnitt: ${p.dateien.join(', ') || 'keine genannt'}`,
  ].join('\n');
}

function lektuere(k: Kontext, p: Paket): string[] {
  const a = adapterWerte(k);
  return [
    a.mustRead ? `must_read (Adapter): ${a.mustRead.join(', ')}` : '`AGENTS.md`, falls vorhanden (must_read, Standard)',
    `Glossar: \`${a.glossary}\` ganz`,
    a.alleAdrs ? `alle ADRs unter \`${a.adrDir}\` (read_all_adrs)` : `die im Issue genannten ADRs unter \`${a.adrDir}\``,
    ...p.lektuere,
  ];
}

const testBefehle = (k: Kontext) =>
  Object.entries(adapterWerte(k).tests)
    .map(([n, b]) => `\`${b}\` (Suite ${n})`)
    .join(', ') || 'keine im Adapter (`test_commands` fehlt)';

/** Phase 1 and 2a–2c of mission/SKILL.md as one call; plan, opening, labels and comments (2d) are the program's */
export function schnittAuftrag(k: Kontext): string {
  return [
    `Schnitt und Vorab-Tor für Mission #${k.epic} in einem Lauf von \`flotte mission\` — dem Programm, das den Paket-Loop von \`/mission\` fährt (agent-skills#69). Du übernimmst Phase 1 (Lesen) und 2a–2c (Pakete, Graph, Vorab-Tor) von \`/mission\`; Plan, Eröffnungskommentar, Labels, Worktrees, Ingenieure, Andocken und Pull Request macht das Programm.`,
    `Missions-Worktree, dein Arbeitsverzeichnis: \`${k.epicWorktree}\` (Branch \`${k.epicBranch}\`). Ausgangszahlen (Phase 0, gemessen vom Programm): ${zahlen(k.basis)}.`,
    [
      '**Du liest nur.** Keine Datei ändern, nichts committen, nichts pushen, keine Issues, Kommentare oder Labels in der Forge, kein `AskUserQuestion`, keine Rückfrage im Text: Alles Fragwürdige ist ein Tor-Punkt im Ergebnis. Lesen in der Forge mit `gh` (etwa `gh issue view <nr> --json title,body,labels,state`), Grep und Glob immer mit `path`. Jeder Befehl im Vordergrund; dein Zug endet nur mit dem Ergebnis.',
    ].join('\n'),
    [
      '## Lesen (Phase 1)',
      '- Zuerst den Adapter `.claude/epic.md` ganz: das Frontmatter sind die Schlüssel, der Fließtext Projektregeln.',
      `- Das Zielissue #${k.epic} **vollständig**. Die **User Stories** sind im Modus \`spec\` die Abnahmeliste, die **Implementation Decisions** Vorgaben *samt Begründung*.`,
      '- **Kanten** nach `dependency_source` (`api`, `header`, `body`). `epic_label` trennt: eine Kante zu einer anderen **Mission** heißt *Reihenfolge*, zu einem **Nicht-Missions-Issue** *Kind*. Bei `header` nennt `Kinder: #a, #b` in der Kopfzeile `> **Reihenfolge:**` die Kinder.',
      '- **Modus:** `issue_form` aus dem Adapter, sonst aus der Form — Kinder → `tickets`, sieben Abschnitte ohne Kinder → `spec`, sonst Vorab-Tor.',
      '- **Vorbedingung:** Ist eine vorausgesetzte Mission offen und greift die transitive Auflösung (`transitive: true`) nicht, ist das ein Tor-Punkt.',
      '- **Kinder einsammeln** (Modus `tickets`, `spec` mit Kindern): je Kind Body, Labels, State, Kanten. Bearbeitbar ist nur, was offen ist und `ready_label` trägt; übersprungen wird ein Kind mit einem der `skip_labels`, ohne `ready_label`, mit Kante in eine fremde offene Mission oder im Modus `tickets` ohne `acceptance_section` oder `verification_section`.',
      '- **Behauptungen im Body gegen den Arbeitsbaum prüfen:** nennt das Issue eine Datei, ein Skript, einen Test als Vorbild, nachsehen, ob es existiert und so heißt. Eine nicht haltbare Behauptung, an der ein Paket hängt, ist ein Tor-Punkt. Widerspricht das Issue einem ADR oder einem Out-of-Scope-Eintrag, ebenso.',
    ].join('\n'),
    [
      '## Pakete (2a)',
      '- **Modus `tickets`:** die bearbeitbaren Kinder; `nr` ist die Nummer des Kindes ohne `#`, die Abnahmeliste der `acceptance_section` des Kindes im Wortlaut, der Verifikationsweg seine `verification_section`. Berührte Module aus `modules_section`, sonst aus der Abnahmeliste erschlossen.',
      `- **Modus \`spec\` ohne Kinder:** du schneidest, \`nr\` ist \`${k.epic}-p<k>\`. Entlang der Implementation Decisions, nicht der Verzeichnisse; sind die Decisions eine Folge, ist die Folge der Schnitt. **Schneide nicht für Parallelität.** Jedes Paket ist für sich verifizierbar. Mechanisches und Urteilsbehaftetes getrennt. Löschungen zuletzt, als eigenes Paket. Eine Datenwurzel kann mehrere Erzeuger haben.`,
      '- **Modus `spec` mit Kindern:** die Kinder sind die Pakete.',
      '- Je Paket: `titel`; `abnahme` **im Wortlaut** (Kind-Body oder die zugeordneten User Stories); `decisions` die betreffenden Implementation Decisions **samt Begründung**; `outOfScope` die betreffenden Out-of-Scope-Punkte; `testing` die Testing Decisions mit benanntem Vorbild; `verifikation` der Verifikationsweg; `lektuere` die im Issue genannten ADRs und das README des betroffenen Moduls; `dateien` die berührten Dateien und Module — mit Code-Graph je Datei oder Symbol `graphify affected "<name>" --depth 1 --graph <graph>` und die Abhängigen dazu.',
      '- **Paketklasse** je Paket: *mechanisch* — als Verschiebung lesbar (Massenumschreiben, Umbenennen, Verschieben, das Löschpaket); *urteil* — Exklusivknoten, führt einen Wächter, ein Tor, eine Schreibsperre oder einen Schema-Versionssprung ein, oder eine Decision ist gegen die naheliegende Lösung geschrieben; *standard* — alles andere. Im Zweifel die höhere; `min_package_class` im Adapter hebt nur an.',
      '- **Zuordnung Story → Paket** (`zuordnung`): jede User Story genau einem Paket (Modus `spec`, `story` ist ihr Wortlaut oder ihre Nummer); im Modus `tickets` ist jedes bearbeitbare Kind eine Story, `story` ist `#<nr>` und geht an sein eigenes Paket. Eine Story ohne Paket ist eine Lücke im Plan, ein Paket ohne Story Arbeit, die niemand verlangt hat. Das Programm hält die Zuordnung gegen das Issue: im Modus `spec` so viele Stories, wie der Abschnitt `## User Stories` Einträge hat; im Modus `tickets` jedes Kind der Mission.',
      '- **Übersprungene Kinder** (`uebersprungen`): jedes Kind der Mission, das kein Paket wird, mit `nr`, dem genauen `grund` (blockierendes Ticket mit Nummer, fehlendes Label, fehlende Abnahmeliste, fehlender Verifikationsweg) und was es freischaltet, und in `blocker` die Nummern blockierender Tickets (sonst leer). Das Programm kommentiert jedes übersprungene Kind und setzt bei einem Blocker `status/blockiert`.',
    ].join('\n'),
    [
      '## Graph (2b)',
      '- `nach`: harte Kante — das Paket setzt die genannten voraus (Kante aus Phase 1 oder Reihenfolge der Decisions) und startet erst, wenn sie angedockt sind.',
      '- `kollision`: beide berühren dieselben Module oder Dateien, Reihenfolge frei, nie gleichzeitig. Zwischen allen Paketen, die eine Datei aus `always_collide` berühren, immer.',
      '- `exklusiv`: läuft allein — ändert einen Pfad aus `exclusive_paths`, trägt `Exklusiv` in `modules_section`, schreibt in eine Datenwurzel mit mehreren Erzeugern oder braucht einen Punkt aus `gate_approvals`.',
      'Das Programm prüft die Form: kein Zyklus über harte Kanten, keine Kante auf ein unbekanntes Paket oder auf sich selbst, keine Nummer doppelt, jede Story genau einem Paket, jedes Paket mit Story und Abnahmeliste. Ein Schnitt, der das verletzt, kommt einmal mit dem Fehler zurück.',
    ].join('\n'),
    [
      '## Vorab-Tor (2c)',
      'Damit der Lauf danach unbeaufsichtigt bleibt, gehört **alles Fragwürdige hierher**, einmal — danach gibt es keine Rückfrage mehr. Vorzulegen ist:',
      '1. Eine vorausgesetzte Mission ist offen, und die transitive Auflösung greift nicht.',
      '2. Das Zielissue ist nicht offen, trägt im Modus `spec` nicht das `ready_label`, oder der Modus ist nicht ableitbar.',
      '3. Ein Adapterwert fehlt und ist nicht ableitbar, oder ein Adaptereintrag würde eine Regel des Skills lockern.',
      '4. Ein Paket braucht Zugriff auf ein System aus `no_access` oder einen anderen, den es hier nicht gibt.',
      '5. Ein Paket würde Produktiv- oder Stammdaten verändern.',
      '6. Das Issue widerspricht einem ADR oder einem Out-of-Scope-Eintrag.',
      '7. Eine Behauptung im Body ist gegen den Arbeitsbaum nicht haltbar, und ein Paket hängt daran.',
      '8. Die Ausgangsmessung ist nicht fahrbar, oder die Testisolation greift nicht.',
      '9. Der Verifikationsweg eines Pakets ist nicht fahrbar (Werkzeug, Zugang oder Ablage fehlt); mit Empfehlung, wie mit dem nicht fahrbaren Teil umgegangen wird.',
      '10. Der Forge-Zugang hat kein Schreibrecht (`gh api repos/{owner}/{repo} --jq .permissions.push`).',
      '11. Kanten wurden aus `body` gelesen, und der Adapter setzt `write_back_dependencies` für sie nicht.',
      '12. Jeder Punkt aus `gate_approvals`, den ein Paket berührt: was es beantwortet, was es kostet, was die harte Grenze ist.',
      '13. Der Adapter hat kein Frontmatter.',
      '14. Ein Paket braucht einen Dienst, der nicht in `shared_services` steht, oder mehr zu starten, als `worktree_may_start` erlaubt; `shared_services` ohne `service_start`; ein Paket ändert das Lockfile eines `link_dirs`-Verzeichnisses.',
      'Je Punkt: `frage`; `betrifft` — die Pakete, die ohne Antwort nicht starten können, samt ihren Nachfolgern im Graphen, oder `Lauf`, wenn wirklich nichts ohne sie geht; `lage` (Sachverhalt); `optionen` mit ihrer Folge im Text, höchstens vier, und `abbruch: true` an der Option, die ablehnt (das Paket oder bei `Lauf` der ganze Lauf startet nicht); `empfehlung` — der Buchstabe der empfohlenen Option (A, B, …); `grund` in einem Satz; `quelle` — die Regel und woher sie stammt (Skill, Adapter oder ADR). Ist nichts zu melden, bleibt `tor` leer.',
    ].join('\n'),
    'Gib das Ergebnis im Schema schnitt (version 1) aus.',
  ].join('\n\n');
}

/** mission/SKILL.md 4a: everything written out, the agent has no other context */
export function implementerAuftrag(k: Kontext, p: Paket, s: PaketZustand, x: { vorgaenger: string[]; torAntworten: string[] }): string {
  const a = adapterWerte(k);
  const b = IMPLEMENTER[s.klasse];
  return [
    `Ingenieur (\`${b.agent}\`) für Paket ${p.nr} „${p.titel}“ der Mission #${k.epic}, Runde ${s.runde}, Paketklasse ${s.klasse}. Der Lauf ist \`flotte mission\`: ein Programm statt eines Orchestrators; es commitet, prüft (4c) und dockt an.`,
    [
      `Worktree: \`${s.worktree}\` — dein Arbeitsverzeichnis, Branch \`${s.branch}\`. Port: ${s.port ?? 'keiner'}, Isolation: ${s.isolation ?? 'keine'}${a.isolationEnv ? ` (Variable \`${a.isolationEnv}\`, gesetzt von \`Up\`)` : ''}.`,
      '`EnterWorktree` ist nicht nötig: der Aufruf läuft schon im Worktree. Du bleibst **innerhalb dieses Worktrees**: absolute Pfade darunter, `Grep` und `Glob` immer mit `path`, kein `git switch`, keine neuen Branches; `Up`, `Down` und `CleanupStale` rufst du nicht auf (references/worktree.md, „Der Subagent im Worktree“).',
    ].join('\n'),
    liste('Abnahmeliste (im Wortlaut):', p.abnahme),
    liste('Implementation Decisions samt Begründung — ohne sie wählst du die naheliegende Lösung, gegen die die Decision geschrieben wurde:', p.decisions),
    liste('Out of Scope (geprüft und verworfen, auch wenn es beim Lesen des Codes nötig erscheint):', [...p.outOfScope, ...(a.outOfScopeDir ? [`dokumentiert unter \`${a.outOfScopeDir}\` (Adapter)`] : [])]),
    liste('Testing Decisions (mit benanntem Vorbild):', p.testing),
    `Verifikationsweg: ${p.verifikation || 'die Abnahmeliste und die Testbefehle des Adapters'}. Fahre ihn im eigenen Worktree${a.isolationEnv ? ` mit gesetzter \`${a.isolationEnv}\`` : ''}, soweit er ohne vollen Stack geht (\`test_commands\`: ${testBefehle(k)}); den Rest fährt der Host in 4c.`,
    `Ausgangszahlen (Phase 0, Missions-Worktree): ${zahlen(k.basis)}.`,
    ...x.vorgaenger.map((t) => `Schnittstelle des Vorgängers (vom Ersten Offizier festgehalten, wörtlich — was tatsächlich dasteht):\n${t}`),
    ...x.torAntworten.map((t) => `Am Vorab-Tor entschieden: ${t}`),
    ...(s.uebernehmen ? ['Ein früherer Aufruf endete ohne gültigen Bericht: Übernimm den Stand im Worktree und arbeite von dort weiter.'] : []),
    ...(s.befund.length ? [liste('Befund der letzten Runde:', s.befund)] : []),
    liste('Pflichtlektüre vor der ersten Änderung:', lektuere(k, p)),
    graphText(k, p),
    liste('Regeln, je mit Herkunft:', [
      `Fachsprache aus \`${a.glossary}\`; Einträge mit \`${a.marker}\` sind Verbote (Skill mission, Regel 6; Adapter \`glossary\`).`,
      'Scope ist strikt die Abnahmeliste, nichts darüber hinaus (Skill mission, Regel 7).',
      'Keine Umbenennung und kein Refactoring ohne Auftrag; keine neue Abhängigkeit ohne Nennung im Issue (Skill mission, 4a).',
      'Keine Tests löschen oder überspringen, um eine Suite grün zu machen (Skill mission, Regel 5).',
      'Ein Skript, das Produktiv- oder Stammdaten umschreibt, wird vorgeschlagen, nicht ausgeführt (Skill mission, Regel 4).',
      'Die Projektregeln des Adapters: der Fließtext von `.claude/epic.md` in deinem Worktree; sie gelten wie die Regeln des Skills (Adapter).',
      '**Nicht committen, nicht branchen** — das macht der Host (Skill mission, 4a und Regel 9).',
      `**Kein voller Stack** (Skill mission, Regel 12, #38) und keine eigenen DB-Server; ein Worktree darf starten: ${a.darfStarten.join(', ')} (Adapter \`worktree_may_start\`, Standard \`dev_server\`).`,
      'Wer außerhalb von `Up` einen Dev-Server startet, beendet ihn am Ende des Pakets (Skill mission, Regel 13, #38).',
      'Nichts in der Forge: keine Issues, Kommentare oder Labels. Verlangt das Paket, dass etwas „im Issue vermerkt“ wird, schreibst du den Text in den Bericht (Skill mission, 4a).',
      ...(k.vorCommitProsa?.length ? [`Prüfungen vor dem Commit, die kein Befehl sind — das Programm fährt sie nicht, du hältst sie selbst ein und nennst sie im Bericht: ${k.vorCommitProsa.join('; ')} (Adapter \`pre_commit_checks\`, Skill mission, 0b).`] : []),
    ]),
    `**Gezielt iterieren, einmal voll:** Während der Arbeit nur die betroffenen Tests (\`jest <dateien>\`, \`--findRelatedTests\` oder das Gegenstück der Suite). Am Ende genau **ein** Volllauf je betroffener Suite; sein Protokoll geht in den Bericht. Testbefehle des Adapters: ${testBefehle(k)}.`,
    [
      'Berichtsform — gib dein Ergebnis im Schema implementer (version 1) aus:',
      '- `dateien` die geänderten, `neueDateien` die neuen Dateien (Pfade relativ zum Worktree);',
      '- `abnahme`: je Abnahmepunkt (`punkt` im Wortlaut) ein Satz, wie er erfüllt ist, mit der Verifikation;',
      '- `volllauf`: das Protokoll des Volllaufs je Suite — Suiten- bzw. Dateizahl, Testzahl, grün;',
      '- `nichtGekonnt`: was du nicht konntest und warum, und als letzte Einträge, was du ausgelassen oder nicht geprüft hast und jedes Risiko, das der Erste Offizier kennen muss; Texte, die „im Issue vermerkt“ werden sollen;',
      '- `fremdarbeit`: übernimmst du bestehende Arbeit (Cherry-pick, fremde Commits, Code aus einem anderen Branch), Quelle (Branch, Original-Hash) und Autor;',
      `- \`betreff\`: der Betreff des Commits, den der Host in 4d macht — nach \`commit_style\` ${a.stil ? `„${a.stil}“` : '(fehlt: wie `git log`)'}, \`commit_language\` ${a.sprache ?? '(fehlt: wie `git log`)'}, \`commit_umlauts\` ${a.umlaute ?? '(fehlt: wie `git log`)'} (Adapter), mit der Issue-Nummer #${/^\d+$/.test(p.nr) ? p.nr : k.epic};`,
      '- `warum`: der Body dieses Commits, das *Warum* der Änderung in zwei bis vier Sätzen.',
    ].join('\n'),
  ].join('\n\n');
}

/** mission/SKILL.md 4b: two axes, the diff command, the new files by name, the lint basis, the interface in a chain, no full run */
export function reviewerAuftrag(k: Kontext, p: Paket, s: PaketZustand, x: { kette: boolean }): string {
  const a = adapterWerte(k);
  const b = REVIEWER[s.klasse];
  const lint = Object.entries(k.basisLint).filter(([d]) => p.dateien.some((m) => d === m || d.startsWith(m.endsWith('/') ? m : `${m}/`)));
  return [
    `Erster Offizier (\`${b.agent}\`) für Paket ${p.nr} „${p.titel}“ der Mission #${k.epic}, Runde ${s.runde}, Paketklasse ${s.klasse}. Der Lauf ist \`flotte mission\`: ein Programm statt eines Orchestrators; es fährt den Volllauf (4c), commitet und dockt an.`,
    `Worktree: \`${s.worktree}\` — dein Arbeitsverzeichnis, derselbe wie der des Ingenieurs. Du bleibst darin; \`Grep\` und \`Glob\` immer mit \`path\`.`,
    `**Diff: \`git -C ${s.worktree} diff HEAD\`.** Der Worktree steht auf dem Missions-Kopf beim Paketstart (${s.kopf ? `\`${s.kopf}\`` : `\`git -C ${s.worktree} rev-parse HEAD\``}); ein Diff gegen den Missions-Branch zeigt inzwischen angedockte Pakete als vermeintliche Änderung — such keine Fehler in fremdem Code.`,
    liste('**Neue Dateien — lies sie direkt**, sie stehen in keinem Diff:', s.bericht?.neueDateien ?? []),
    karte(k.adapter, 'lint_commands')
      ? `Lint-Basis der betroffenen Module (Phase 0): ${lint.length ? lint.map(([d, n]) => `${d}: ${n}`).join(', ') : 'keine Befunde in diesen Dateien'}. Melde die Differenz: neue Befunde in geänderten Dateien sind ein Befund, auch wenn der Lint-Befehl mit 0 endet.`
      : 'Lint-Basis: der Adapter nennt keine `lint_commands`, der Lint-Vergleich entfällt.',
    liste('Abnahmeliste (im Wortlaut):', p.abnahme),
    liste('Implementation Decisions samt Begründung:', p.decisions),
    liste('Out of Scope:', p.outOfScope),
    liste('Testing Decisions:', p.testing),
    `Verifikationsweg: ${p.verifikation || 'die Abnahmeliste und die Testbefehle des Adapters'}. Ausgangszahlen (Phase 0): ${zahlen(k.basis)}.`,
    `Bericht des Ingenieurs:\n${JSON.stringify(s.bericht, null, 1)}`,
    [
      'Prüfe zwei Achsen getrennt:',
      '- **Spec:** Ist jeder Abnahmepunkt erfüllt — nachweisbar, nicht behauptet? Ist etwas gebaut, was niemand verlangt hat? Ist ein Out-of-Scope-Punkt verletzt, eine Decision umgangen, weil die naheliegende Lösung bequemer war?',
      `- **Standards:** Fachsprache aus \`${a.glossary}\` (Verbote mit \`${a.marker}\`); kein toter oder auskommentierter Rest; keine ADR-Verletzung; Tests entlang des Verifikationswegs in der Form des Vorbilds; Stil des umgebenden Codes; die Projektregeln des Adapters (Fließtext von \`.claude/epic.md\`).`,
      '**Ein Wächter oder ein Tor wird gegen sich selbst geprüft: Positivprobe und Gegenprobe.**',
      '**Führt das Paket eine Schreibsperre, einen Update-Schutz oder eine neue Validierung ein, suchst du jeden anderen Schreiber derselben Felder** — Migration, Import, Skripte, Hintergrundjobs, andere Endpunkte und die Pfade aus `writers` im Adapter — und belegst je Schreiber, dass er durchkommt, oder meldest ihn als Befund. Ein Schreiber, den nur ein Trockenlauf abdeckt, gilt als nicht geprüft.',
    ].join('\n'),
    graphText(k, p).replace('Code-Graph (', 'Code-Graph — der erste Griff, nicht der Beleg: ein Schreiber, den der Graph nicht nennt, ist damit nicht ausgeschlossen (').replace(/\nBerührte Dateien.*$/, ''),
    '**Du fährst keinen Volllauf.** Prüfe Zahlen und Protokoll des Ingenieurs gegen die Ausgangszahlen, fahre gezielt die betroffenen Tests und deine Gegenproben. Rot nur in Dateien, die das Paket nicht berührt, und einzeln grün ist ein Lastflake: vermerken, kein Befund. Den Volllauf je Paket fährt der Host in 4c; ein zweiter im Review kostet Minuten und fand bisher nichts Neues (Skill mission, 4b).',
    'Du **korrigierst selbst, aber nur im Kleinen**: Benennung, Kommentar, ein fehlender Testfall, ein vergessener Rest — jede solche Korrektur steht in `selbstkorrekturen`. Eine strukturelle Abweichung oder einen verletzten Abnahmepunkt berichtest du als Befund. Nicht committen, nicht branchen. Funde außerhalb des Pakets nennst du als Befund der Gruppe `kann`, ohne Issues anzulegen oder vorzuschlagen (Skill mission, Regel 3).',
    x.kette
      ? '**Das Paket steht in einer Kette: halte in `schnittstelle` fest, was tatsächlich dasteht** — Signatur, Merkmale der Ausgabe, jede Abweichung vom Vorgänger. Der Ingenieur beschreibt, was er bauen wollte; dieser Abschnitt geht wörtlich in den Auftrag des Nachfolgers.'
      : 'Das Paket steht in keiner Kette: `schnittstelle` ist eine kurze Beschreibung dessen, was tatsächlich dasteht (eine Zeile genügt).',
    [
      'Gib dein Ergebnis im Schema reviewer (version 1) aus:',
      '- `befunde` in drei Gruppen — `muss` (verletzter Abnahmepunkt, umgangene Decision, verletzter Out-of-Scope-Punkt, Fehler mit konkretem Fall, Sicherheitslücke, Datenverlust), `sollte` (riskante neue Logik ohne Test, Dopplung, Code, den niemand verlangt hat), `kann` (kürzere Form, kleine Beschleunigung) —, jeder mit `fundstelle` (`Datei:Zeile`) und im `text` dem konkreten Fall und der kleinsten Korrektur. Kein konkreter Fall, kein Befund. **Nur ein Muss-Befund löst eine neue Runde aus**; was du nicht prüfen konntest, nennst du als Befund der Gruppe `sollte` mit dem Anfang „Nicht geprüft:“;',
      '- `strukturell`: `true` nur bei einer strukturellen Abweichung — sie lässt die nächste Runde eine Stufe höher laufen; ein verletzter Abnahmepunkt allein ist nicht strukturell;',
      '- `schnittstelle` wie oben; `selbstkorrekturen` deine kleinen Korrekturen.',
    ].join('\n'),
  ].join('\n\n');
}

/** Phase 5: a merge conflict in the epic worktree; only the mechanical one is resolved, the program finishes the merge */
export function konfliktAuftrag(k: Kontext, p: Paket, s: PaketZustand): string {
  return [
    `Andockkonflikt im Missions-Worktree \`${k.epicWorktree}\` (Branch \`${k.epicBranch}\`) beim \`git merge --no-ff ${s.branch}\` — Paket ${p.nr} „${p.titel}“ der Mission #${k.epic}, in einem Lauf von \`flotte mission\`. Das Programm hat das Andocken begonnen; der Worktree steht mitten im \`git merge\`.`,
    liste('Dateien mit Konflikt:', s.konflikt?.dateien ?? []),
    liste('Abnahmeliste des Pakets (zum Verständnis):', p.abnahme),
    [
      '**Löse ihn nur, wenn er mechanisch ist:** getrennte Zeilen, Importlisten, benachbarte Einträge, bei denen beide Seiten bleiben. Dann die Konfliktmarker entfernen, beide Seiten behalten und die Dateien mit `git add` vormerken — **nicht committen**, kein `git merge --continue`, kein `git merge --abort`: das Programm schließt das Andocken ab und fährt die Tests auf dem Missions-Branch.',
      'Ist er **inhaltlich** — beide Seiten sagen an derselben Stelle Verschiedenes, eine Version, ein Grund oder eine Entscheidung steht gegen eine andere —, änderst du nichts und meldest `inhaltlich` mit Begründung; das Paket wird zurückgelassen, ein Mensch entscheidet.',
      'Du arbeitest nur im Missions-Worktree, kein `git switch`, kein Push. Jeder Befehl im Vordergrund; dein Zug endet nur mit dem Ergebnis.',
    ].join('\n'),
    'Gib das Ergebnis im Schema konflikt (version 1) aus: `ergebnis` `geloest` oder `inhaltlich`, `begruendung` in einem bis drei Sätzen.',
  ].join('\n\n');
}

/** claude-sonnet-5-5 → Claude Sonnet 5.5, claude-opus-4-1-20250805 → Claude Opus 4.1; null for any other name */
export function modellName(id: string | null | undefined): string | null {
  const m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id ?? '');
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : null;
}

const UMLAUTE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };

/**
 * 4d: one commit on the package branch after commit_style, commit_language and commit_umlauts of the
 * adapter; the issue number in the subject, the why from the implementer's report in the body, at
 * the end the Co-Authored-By line of the model that wrote the package.
 */
export function commitNachricht(k: Kontext, p: Paket, s: PaketZustand, ticket: number): string {
  const a = adapterWerte(k);
  const r = s.bericht;
  let betreff = (r?.betreff ?? '').split(/\r?\n/)[0].trim() || p.titel;
  if (a.stil && /conventional/i.test(a.stil) && !/^[a-z]+(\([^)]*\))?!?: /.test(betreff)) betreff = `feat: ${betreff}`;
  if (!betreff.includes(`#${ticket}`)) betreff = `${betreff} (#${ticket})`;
  const warum = r?.warum.trim() || (r?.abnahme ?? []).map((x) => `- ${x.punkt}: ${x.satz}`).join('\n');
  const en = a.sprache === 'en';
  const modell = modellName(s.modell) ?? `Claude ${IMPLEMENTER[s.klasse].modell === 'opus' ? 'Opus' : 'Sonnet'}`;
  const text = [
    betreff,
    '',
    ...(warum ? [warum, ''] : []),
    ...(r?.fremdarbeit.length ? [`${en ? 'Taken over' : 'Übernommen'}: ${r.fremdarbeit.join('; ')}`, ''] : []),
    en ? `Package ${p.nr} of epic #${k.epic}, accepted by flotte mission (4c).` : `Paket ${p.nr} der Mission #${k.epic}, abgenommen von flotte mission (4c).`,
    '',
    `Co-Authored-By: ${modell} <noreply@anthropic.com>`,
    '',
  ].join('\n');
  return a.umlaute === 'transliterate' ? text.replace(/[äöüÄÖÜß]/g, (c) => UMLAUTE[c]) : text;
}
