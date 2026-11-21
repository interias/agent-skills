// Maschinenraum (#42): accounts, machines and the beat of the driver. Until then an empty state.
// The shell (huelle.js) calls zeichne(t, el) on every load while the area is visible; t is null
// before the first load. All scripts of the page share one scope: keep every name inside this call.
'use strict';

huelle.bereich({
  name: 'maschinenraum',
  titel: 'Maschinenraum',
  zeichne(t, el) {
    if (el.childElementCount) return;
    el.innerHTML = '<h2 class="ek bereich-kopf">Maschinenraum</h2><p class="bereich-leer">Hier entsteht der Maschinenraum: Konten mit 5-h- und Wochenfenster, Anmeldung, RAM und Platte, Takt, Obergrenze und Bremsen des Treibers.</p>';
  },
});
