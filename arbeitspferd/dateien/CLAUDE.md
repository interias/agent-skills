@~/.claude/CLAUDE.md

# Arbeitspferd (Terminal, zweites Konto)
Niemand sitzt am Bildschirm, eine Erlaubnisfrage im Fenster hält den Lauf auf. Deshalb kein
`EnterWorktree`: In einem Worktree mit absoluten Pfaden oder `cd <worktree> && …` arbeiten.
Aus demselben Grund Dateien aus Skill-Ordnern mit Read lesen und mit Write schreiben statt per Bash
cp/sed, in Bash keine Befehlsersetzung `$( … )` und keine verketteten sed/awk-Einzeiler, lieber
mehrere einfache Befehle.
