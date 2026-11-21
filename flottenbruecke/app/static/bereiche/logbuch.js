// Logbuch (#42): events and decisions in order, filterable. Until then an empty state.
// The shell (huelle.js) calls zeichne(t, el) on every load while the area is visible; t is null
// before the first load. All scripts of the page share one scope: keep every name inside this call.
'use strict';

huelle.bereich({
  name: 'logbuch',
  titel: 'Logbuch',
  zeichne(t, el) {
    if (el.childElementCount) return;
    el.innerHTML = '<h2 class="ek bereich-kopf">Logbuch</h2><p class="bereich-leer">Hier entsteht das Logbuch: Ereignisse und Entscheidungen von Admiral und Mensch der Reihe nach, filterbar nach Epic und Art.</p>';
  },
});
