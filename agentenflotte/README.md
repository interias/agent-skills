# Agentenflotte

A Claude Code mod that shows running subagents as a pixel starship convoy above the prompt. The main session leads as the flagship; every subagent follows in formation.

- **Ship class = model:** Haiku shuttle, Sonnet cruiser, Opus heavy cruiser, Fable science vessel; two variants each, picked per agent.
- **Warp factor = effort:** low to max is warp 2 to 9.9: brighter nacelles, a longer warp trail, shields up at max.
- **Alert = state:** yellow while a subagent waits for your permission, red when it fails. New agents drop out of warp; finished ones jump away.

The desktop app draws an animated SVG with tooltips; the terminal draws half-block pixels. `/flotte` hides or shows the band.

## Install

Run `install.ps1` at the repo root; it adds this repo as the marketplace `breuckmann-agent-skills` and installs the plugin at user scope. Upstream: [interias/agentenflotte](https://github.com/interias/agentenflotte).

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
