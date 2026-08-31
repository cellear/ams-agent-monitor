/* Sprint file parsing → board model. Global: AMSSprints
   Canonical forms in spec/ams-monitor-format.md §2. Legacy tolerance is marked. */
var AMSSprints = (function () {
  'use strict';

  var SPRINT_FILE = /^sprint-(\d+[a-z]*)\.md$/i;
  var STORY_RE    = /^###\s+(\S+)\s+·\s+(.+?)\s+·\s+\[([ xX])\]\s*$/gm;
  var H1_RE       = /^#\s+(.+?)\s*$/m;
  var STATUS_RE   = /^\*\*Status:\*\*\s*(.*)$/m;

  /* §2.2 "sprint-5a.md" → {num:5, suffix:"a"}; orders 5 < 5a < 5b < 6. */
  function idParts(id) {
    var m = /^(\d+)([a-z]*)$/i.exec(id);
    return m ? { num: parseInt(m[1], 10), suffix: m[2].toLowerCase() } : { num: 0, suffix: id };
  }
  function compareIds(a, b) {
    var x = idParts(a), y = idParts(b);
    return x.num !== y.num ? x.num - y.num : (x.suffix < y.suffix ? -1 : x.suffix > y.suffix ? 1 : 0);
  }

  /* §2.1 Split the H1 on the FIRST colon. Never on the em-dash: only some
     sprints have one, and where present it belongs to the theme. */
  function parseTitle(body, id) {
    var m = H1_RE.exec(body || '');
    var line = m ? m[1].trim() : '';
    var colon = line.indexOf(':');
    if (colon === -1) return { name: line || ('Sprint ' + id), theme: '' };
    return { name: line.slice(0, colon).trim(), theme: line.slice(colon + 1).trim() };
  }

  /* §2.3 Acceptance comes from the **Status:** line, not body non-emptiness.
     Canonically a bare "Accepted"/"Pending". Legacy tolerance: "✓ Accepted",
     "✅ **ACCEPTED** by Luke (PO), …", "Accepted — Luke, in-session, …". */
  function parseAcceptance(body) {
    var section = /^##\s+Acceptance\s*$([\s\S]*?)(?=^##\s|\Z)/m.exec(body || '');
    if (!section) return { accepted: false, status: null, present: false, legacy: false };
    var m = STATUS_RE.exec(section[1]);
    var raw = m ? m[1].trim() : '';
    var bare = raw.replace(/\*\*/g, '').replace(/[✓✅]/g, '').trim();
    var accepted = /accepted/i.test(bare);
    return {
      accepted: accepted, status: raw, present: true,
      /* Non-canonical if it is decorated or carries prose beyond the bare word. */
      legacy: accepted && !/^accepted$/i.test(bare)
    };
  }

  function parseStories(body) {
    var out = [], m;
    STORY_RE.lastIndex = 0;
    while ((m = STORY_RE.exec(body || '')) !== null) {
      out.push({ id: m[1], title: m[2].trim(), done: m[3].toLowerCase() === 'x' });
    }
    return out;
  }

  function parseFile(name, body) {
    var fm = SPRINT_FILE.exec(name);
    var id = fm ? fm[1] : name.replace(/\.md$/, '');
    var t = parseTitle(body, id);
    return {
      id: id, file: name, name: t.name, theme: t.theme,
      stories: parseStories(body),
      acceptance: parseAcceptance(body)
    };
  }

  function isSprintFile(entry) {
    return entry && entry.type !== 'dir' && SPRINT_FILE.test(entry.name || '');
  }

  /* Board model. §2.5:
     - current  = LOWEST-ordered sprint not accepted (the one being worked)
     - progress = first unchecked story in the current sprint, at most one
     - stale    = unchecked story inside an ACCEPTED sprint. §2.4 forbids this
                  going forward; legacy files still have it, so it renders muted
                  rather than being mistaken for upcoming work. */
  function build(files) {
    var sprints = files.slice().sort(function (a, b) { return compareIds(a.id, b.id); });

    var current = null;
    for (var i = 0; i < sprints.length; i++) {
      if (!sprints[i].acceptance.accepted) { current = sprints[i]; break; }
    }
    var allAccepted = current === null;
    if (allAccepted && sprints.length) current = sprints[sprints.length - 1];

    sprints.forEach(function (s) {
      s.isCurrent = s === current;
      var assigned = false;
      s.stories.forEach(function (st) {
        if (st.done) { st.state = 'done'; return; }
        if (s.acceptance.accepted) { st.state = 'stale'; return; }
        if (s.isCurrent && !allAccepted && !assigned) { st.state = 'progress'; assigned = true; return; }
        st.state = 'planned';
      });
      s.done = s.stories.filter(function (st) { return st.state === 'done'; }).length;
      s.total = s.stories.length;
    });

    return {
      sprints: sprints,
      current: current,
      allAccepted: allAccepted,
      inProgress: sprints.reduce(function (acc, s) {
        return acc.concat(s.stories.filter(function (st) { return st.state === 'progress'; }));
      }, [])
    };
  }

  return {
    build: build, parseFile: parseFile, isSprintFile: isSprintFile,
    compareIds: compareIds, parseTitle: parseTitle,
    parseAcceptance: parseAcceptance, parseStories: parseStories,
    SPRINT_FILE: SPRINT_FILE
  };
})();
