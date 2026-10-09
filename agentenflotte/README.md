# Agentenflotte

A Claude Code mod that turns the session into a starship bridge: the interface speaks the bridge's language (in German), subagents are ships of the fleet, and the alert level shows what needs you. Every part has its own switch.

## Alert levels

The status line, the spinner, the mode label and the radar frame follow the alert. The highest applies.

| Level | When |
|---|---|
| Yellow | a subagent waits for your permission |
| Red | a subagent fails, or the main session fails (for 15 seconds) |
| Blue | less than 20 % of the context window is left, or the main conversation compacts |

## Bridge

- **Spinner:** the working words are bridge talk (`Warpkern kalibrieren`, `Kurs berechnen`); under an alert they change to `Autorisierung abwarten` and the like.
- **Station labels** on tool rows: `Sensorscan` (Grep, Glob, web), `Archiv` (Read), `Shuttlestart` (Agent), `Maschinenraum` (Edit, Write), `Konsole` (Bash), `Transporter` (worktrees); a failed tool shows `Hüllenbruch`.
- **Under-warp line** after a turn: `Unter Warp · 1 min 12 s`.
- **Warp factor = effort:** low to max is warp 2, 4, 6, 8, 9.9.
- **Status line:** stardate, warp factor of the main session, shields (context left), fleet size and the alert, e.g. `SZ 80769.9 · Warp 6 · Schilde 64 % · Flotte 3`.
- **Mode label:** on an alert, `Alarmstufe Gelb|Rot|Blau` joins the session modes.
- **Permission note:** a line under a permission dialog says who asks (`Alarmstufe Gelb · Maschinenraum erbittet Autorisierung`).
- **Calls:** a toast when a subagent returns (`Eingehender Ruf`) or fails (`Hüllenbruch`).

## Log

After every answer of the main session a log line counts what the subagents did (`Logbuch, Sternzeit 80769.9: 2 Shuttles gestartet, 2 zurück an Bord.`); it is made from counters, not by the model, and appears only when something happened. `/logbuch` shows the last ten entries, `/logbuch alle` the last fifty. The log keeps 200 entries across sessions.

## Ship's computer

A message that starts with `Computer,` is answered tersely, numbers first, without greeting or filler. It never applies to code, commit messages, pull request texts, tickets, files or reports to others. Off by default: `/flotte computer an`.

## Tactical display

`/taktik` opens or closes the pane. On the desktop it shows a radar: the main session in the middle, one contact per subagent, the distance growing with its run time, the color by model; waiting contacts blink yellow, failed ones are red, finished ones grey. Below it the station list: Wissenschaft, Maschinenraum, Taktik, Navigation, Brücke. The terminal shows a text version per station. With the main switch off (`/flotte`) the pane does not open.

## Switches

| Command | Effect |
|---|---|
| `/flotte` | main switch: hide or show the whole mod |
| `/flotte status` | show the main switch and every part |
| `/flotte <bruecke\|logbuch\|computer> [an\|aus]` | switch one part, or toggle it without an argument |

The switches persist across sessions. Defaults: everything on except the computer.

To turn the whole mod off, run `/plugin`, pick agentenflotte and choose Disable, or in a shell:

```
claude plugin disable agentenflotte@breuckmann-agent-skills
```

## Install

Run `install.ps1` at the repo root; it adds this repo as the marketplace `breuckmann-agent-skills` and installs the plugin at user scope. Upstream: [interias/agentenflotte](https://github.com/interias/agentenflotte).

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
