// Sternenkarte (#43): the projects with their open epics and backlog. Until then an empty state.
// The shell (huelle.js) calls zeichne(t, el) on every load while the area is visible; t is null
// before the first load. All scripts of the page share one scope: keep every name inside this call.
'use strict';

huelle.bereich({
  name: 'sternenkarte',
  titel: 'Sternenkarte',
  zeichne(t, el) {
    if (el.childElementCount) return;
    el.innerHTML = '<h2 class="ek bereich-kopf">Sternenkarte</h2><p class="bereich-leer">Hier entsteht der Überblick über die Projekte: offene Epics mit ihren Tickets, Reihenfolge, was läuft und was wartet, dazu die Prognose.</p>';
  },
});
