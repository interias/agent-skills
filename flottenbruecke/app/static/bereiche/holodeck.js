// Holodeck (#44): the prototypes of each project, read only and sealed off. Until then an empty state.
// The shell (huelle.js) calls zeichne(t, el) on every load while the area is visible; t is null
// before the first load. All scripts of the page share one scope: keep every name inside this call.
'use strict';

huelle.bereich({
  name: 'holodeck',
  titel: 'Holodeck',
  zeichne(t, el) {
    if (el.childElementCount) return;
    el.innerHTML = '<h2 class="ek bereich-kopf">Holodeck</h2><p class="bereich-leer">Hier entsteht die Galerie der Prototypen: je Projekt ein fester Ordner, jede Seite darin als Kachel, nur zum Ansehen und abgeschottet von der Brücke.</p>';
  },
});
