/* Handoff file parsing. Global: AMSHandoffs
   Canonical five sections in spec §3; legacy mapping table in §3.1. */
var AMSHandoffs = (function () {
  'use strict';

  var FILE_RE = /^handoff-(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/i;
  var SECTIONS = ['Context', "What's done", "What's next", 'Notes / blockers', 'Files / references'];
  var PROMPT_KEY = 'prompt for next';

  /* §3.1 First rule that hits wins, so order matters: "what was done" must be
     tested before the broader "what" patterns, and "files" last. Exact-set
     matching is not viable — "Files created or modified" alone appears in four
     casings across the two reference projects. */
  var RULES = [
    ['Context',            ['summary', 'current state', 'the project']],
    ["What's done",        ['what was done', 'what was attempted', 'outcome', 'what worked', "what's done"]],
    ["What's next",        ['next steps', 'recommendations', "what's next"]],
    ['Notes / blockers',   ['open question', 'blocker', "what didn't", 'judgment call', 'judgement call',
                            'design note', 'overstepped', 'finding', 'note']],
    ['Files / references', ['files created', 'files modified', 'stray files', 'files /', 'references']]
  ];

  function norm(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  function bucketFor(heading) {
    var n = norm(heading);
    for (var i = 0; i < RULES.length; i++) {
      for (var j = 0; j < RULES[i][1].length; j++) {
        if (n.indexOf(RULES[i][1][j]) !== -1) return RULES[i][0];
      }
    }
    return null;
  }

  function dateFromName(name) {
    var m = FILE_RE.exec(name);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  /* "handoff-2026-08-30-s2-5-result-page-cody.md" → "S2-5 · result page · cody".
     The story id survives the split on hyphens only if it is rejoined; without
     this the label reads "s2 5 result page". */
  var ID_HEAD = /^([sf])(\d+[a-z]*)$/i;

  function labelFromName(name) {
    var m = FILE_RE.exec(name);
    if (!m) return name.replace(/\.md$/, '');
    var parts = m[4].split('-');
    var id = null;
    var head = ID_HEAD.exec(parts[0] || '');
    if (head && /^([0-9]+|r)$/i.test(parts[1] || '')) {
      id = (head[1] + head[2]).toUpperCase() + '-' + parts[1].toUpperCase();
      parts = parts.slice(2);
    }
    var agent = parts.length > 1 ? parts.pop() : null;
    var slug = parts.join(' ');
    return [id, slug, agent].filter(Boolean).join(' · ');
  }

  /* Split on ## headings, keeping anything before the first one as a preamble. */
  function splitSections(body) {
    var lines = String(body || '').split(/\r?\n/);
    var out = [], cur = { heading: null, lines: [] };
    lines.forEach(function (line) {
      var m = /^##\s+(.+?)\s*$/.exec(line);
      if (m) { out.push(cur); cur = { heading: m[1], lines: [] }; }
      else { cur.lines.push(line); }
    });
    out.push(cur);
    return out.filter(function (s) { return s.heading !== null || s.lines.join('').trim() !== ''; });
  }

  function parse(name, body) {
    var raw = splitSections(body);
    var buckets = {}, extras = [], prompt = null, preamble = '', title = null;
    SECTIONS.forEach(function (s) { buckets[s] = []; });

    raw.forEach(function (sec) {
      var text = sec.lines.join('\n').trim();
      if (sec.heading === null) {
        /* Preamble: an H1 title line plus the header line (persona · model · story). */
        var h1 = /^#\s+(.+?)\s*$/m.exec(text);
        if (h1) title = h1[1].trim();
        preamble = text.replace(/^#\s+.+$/m, '').trim();
        return;
      }
      if (norm(sec.heading).indexOf(PROMPT_KEY) !== -1) {
        prompt = { heading: sec.heading, body: text };
        return;
      }
      var b = bucketFor(sec.heading);
      if (b) buckets[b].push({ heading: sec.heading, body: text, canonical: norm(sec.heading) === norm(b) });
      else extras.push({ heading: sec.heading, body: text });
    });

    return {
      file: name, date: dateFromName(name), label: labelFromName(name),
      title: title, preamble: preamble,
      sections: SECTIONS.map(function (s) { return { name: s, parts: buckets[s] }; }),
      extras: extras, prompt: prompt,
      mapped: SECTIONS.some(function (s) { return buckets[s].length > 0; })
    };
  }

  /* Newest first: filename date descending, then filename descending so the
     order is stable before commit times are known. */
  function sortIndex(entries) {
    return entries.slice().sort(function (a, b) {
      var da = dateFromName(a.name) || '', db = dateFromName(b.name) || '';
      if (da !== db) return da < db ? 1 : -1;
      return a.name < b.name ? 1 : -1;
    });
  }

  function isHandoffFile(entry) {
    return entry && entry.type !== 'dir' && /\.md$/i.test(entry.name || '') &&
           !/^(README|PROTOCOL|TEMPLATE)\.md$/i.test(entry.name);
  }

  return {
    parse: parse, sortIndex: sortIndex, isHandoffFile: isHandoffFile,
    bucketFor: bucketFor, dateFromName: dateFromName, labelFromName: labelFromName,
    SECTIONS: SECTIONS
  };
})();
