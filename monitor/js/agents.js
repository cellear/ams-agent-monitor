/* Agent identity → colour. Global: AMSAgents.

   Colours are assigned two ways. Named AMS personas get a fixed colour, so the
   same persona reads the same on every project that uses the standard roster
   (Cody, Sandy, Lila and the rest are AMS personas, not one project's staff).
   Anyone else is hashed into the same palette — deterministically, so an agent
   keeps its colour across loads and browsers. First-seen order would reshuffle
   whenever story order changed.

   Every fill is pastel enough for black body text, and all of them are kept
   clearly warmer or cooler than the grey used for dropped stories, so a dropped
   story can never read as somebody's colour. */
var AMSAgents = (function () {
  'use strict';

  /* Ordered; unknown agents hash into this. */
  var PALETTE = [
    { name: 'blue',   fill: '#bcd8f2', edge: '#7aa8cc' },
    { name: 'orange', fill: '#fbdca6', edge: '#d9a44f' },
    { name: 'green',  fill: '#c2e2bd', edge: '#7fb277' },
    { name: 'lilac',  fill: '#d8cbee', edge: '#9d8cc4' },
    { name: 'rose',   fill: '#f5c8d4', edge: '#cf88a0' },
    { name: 'teal',   fill: '#b4e0da', edge: '#6fb0a8' },
    { name: 'butter', fill: '#f2e6a6', edge: '#c4b25c' },
    /* Deliberately darker than orange rather than merely browner: at pastel
       saturation the two hues converge, and lightness is what separates them
       at a distance. */
    { name: 'brown',  fill: '#cda87e', edge: '#8f6f45' },
    { name: 'sky',    fill: '#cfe6f5', edge: '#8ab6d0' },
    { name: 'mint',   fill: '#cdeadb', edge: '#82b89b' }
  ];

  /* Luke's terminal colours for the personas he runs, treated as the default
     for the standard AMS roster. A project can override these later. */
  var NAMED = {
    cody: 'blue', sandy: 'orange', archie: 'brown',
    lila: 'lilac', nadia: 'green', quinn: 'rose',
    hannah: 'butter', priya: 'teal', eric: 'sky', luke: 'mint'
  };

  function byName(colourName) {
    for (var i = 0; i < PALETTE.length; i++) {
      if (PALETTE[i].name === colourName) return PALETTE[i];
    }
    return null;
  }

  /* djb2. Small, stable, and enough to spread a dozen names. */
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /* A name's preferred colour, before collisions are considered. */
  function preferred(agent) {
    var key = String(agent || '').trim().toLowerCase();
    if (!key) return null;
    return (NAMED[key] && byName(NAMED[key])) || PALETTE[hash(key) % PALETTE.length];
  }

  /* Assign colours across a whole board at once, so no two agents on the same
     board share one. Preferences are honoured first; anyone whose preference is
     already taken probes forward through the palette. Sorting the names first
     keeps the result stable — it must not depend on the order stories happen to
     appear in. With more agents than palette entries, colours repeat rather
     than run out. */
  function assign(names) {
    /* Named personas claim first, so an unfamiliar agent can never take Cody's
       blue and push Cody onto something else. Within each group, sorted order
       keeps the result independent of the order stories appear in. */
    var all = (names || []).slice().sort();
    var isNamed = function (n) { return !!NAMED[String(n).trim().toLowerCase()]; };
    var sorted = all.filter(isNamed).concat(all.filter(function (n) { return !isNamed(n); }));
    var taken = {}, out = {};

    sorted.forEach(function (name) {
      var want = preferred(name);
      if (!want) return;
      var idx = PALETTE.indexOf(want);
      for (var i = 0; i < PALETTE.length; i++) {
        var probe = (idx + i) % PALETTE.length;
        if (!taken[probe]) { taken[probe] = true; out[name] = PALETTE[probe]; return; }
      }
      out[name] = PALETTE[idx];   /* palette exhausted: allow a repeat */
    });
    return out;
  }

  function namesIn(sprints) {
    var seen = {};
    (sprints || []).forEach(function (s) {
      (s.stories || []).forEach(function (st) {
        (st.owners || []).forEach(function (o) { seen[o] = true; });
      });
    });
    return Object.keys(seen);
  }

  /* {name, colour} for every agent on the board, for the legend. */
  function roster(sprints) {
    var map = assign(namesIn(sprints));
    return Object.keys(map).sort().map(function (n) {
      return { name: n, colour: map[n] };
    });
  }

  return { preferred: preferred, assign: assign, roster: roster,
           namesIn: namesIn, PALETTE: PALETTE, NAMED: NAMED };
})();
