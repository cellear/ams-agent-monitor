/* Checks for the AMS Agent Monitor. Global: AMSChecks.

   Two layers. Unit checks exercise the parsers directly — they are pure
   functions over strings, so they need nothing but the module. Integration
   checks drive the real index.html in an iframe with ?fixtures=1, which is why
   there is no second copy of the page skeleton to drift out of date.

   Every regression case below is a bug that actually happened during the build,
   not a hypothetical. The comment on each says which. */
var AMSChecks = (function () {
  'use strict';

  var suites = [];
  function suite(name, fn) { suites.push({ name: name, fn: fn }); }

  function Ctx(results, suiteName) {
    this.results = results; this.suite = suiteName;
  }
  Ctx.prototype._push = function (pass, label, detail) {
    this.results.push({ suite: this.suite, label: label, pass: pass, detail: detail });
  };
  Ctx.prototype.ok = function (cond, label) {
    this._push(!!cond, label, cond ? null : 'expected truthy, got ' + JSON.stringify(cond));
  };
  Ctx.prototype.eq = function (actual, expected, label) {
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    this._push(a === b, label, a === b ? null : 'expected ' + b + ', got ' + a);
  };

  /* ------------------------------------------------------------------ *
   * Unit: sprint parsing                                                *
   * ------------------------------------------------------------------ */

  suite('sprints — acceptance', function (t) {
    /* REGRESSION: JavaScript has no end-of-input anchor. The original lookahead
       `(?=^##\s|\Z)` matched a literal "Z", so a sprint whose ## Acceptance was
       the final section read as pending. Caught on live muse-monitor, where it
       invented a current sprint and an in-progress story. */
    var last = '# Sprint 5a: UI v1\n\n### S5a-1 · A · [x]\n\n## Acceptance\n\n' +
               '**Status:** ✓ Accepted\n**Date:** 2026-08-15\n\nDemo verified.';
    t.ok(AMSSprints.parseAcceptance(last).accepted, 'accepted when Acceptance ends the file');

    var mid = '# Sprint 2: X\n\n## Acceptance\n\n**Status:** Accepted\n\n## Report\n\nmore';
    t.ok(AMSSprints.parseAcceptance(mid).accepted, 'accepted when another section follows');

    /* Canonical form, and the four decorated legacy forms found in real files. */
    [['**Status:** Accepted', false],
     ['**Status:** ✓ Accepted', true],
     ['**Status:** ✅ **ACCEPTED** by Luke (PO), 2026-08-16', true],
     ['**Status:** Accepted — Luke, 2026-08-17, in-session, after `make demo`', true]
    ].forEach(function (pair) {
      var body = '# S\n\n## Acceptance\n\n' + pair[0] + '\n';
      var a = AMSSprints.parseAcceptance(body);
      t.ok(a.accepted, 'accepted: ' + pair[0].slice(0, 38));
      t.eq(a.legacy, pair[1], 'non-canonical flagged: ' + pair[0].slice(0, 38));
    });

    t.ok(!AMSSprints.parseAcceptance('# S\n\n## Acceptance\n\n**Status:** Pending\n').accepted,
      'Pending is not accepted');
    t.ok(!AMSSprints.parseAcceptance('# S\n\n## Acceptance\n\n**Status:**\n').accepted,
      'empty Status is not accepted');
    t.ok(!AMSSprints.parseAcceptance('# S\n\nno section here').present,
      'missing Acceptance section reported absent');
  });

  suite('sprints — ordering and titles', function (t) {
    /* REGRESSION: muse-monitor has 5a and 5b. Plain numeric or plain string
       sorts both get this wrong. */
    var ids = ['10', '5b', '2', '5a', '5', '6'];
    t.eq(ids.slice().sort(AMSSprints.compareIds), ['2', '5', '5a', '5b', '6', '10'],
      '5 < 5a < 5b < 6 < 10');

    /* REGRESSION: the theme was split on the em-dash, which only 4 of 13 real
       sprints have. Sprints 0–4 of both projects have none. */
    t.eq(AMSSprints.parseTitle('# Sprint 2: It\'s a website', '2'),
      { name: 'Sprint 2', theme: "It's a website" }, 'splits on the colon');
    t.eq(AMSSprints.parseTitle('# Sprint 5a: UI v1, part 1 — scaffold, SSE store', '5a'),
      { name: 'Sprint 5a', theme: 'UI v1, part 1 — scaffold, SSE store' },
      'an em-dash stays in the theme');
    t.eq(AMSSprints.parseTitle('# Sprint 3', '3').theme, '', 'no colon yields no theme');
  });

  suite('sprints — stories', function (t) {
    var body = [
      '# Sprint 2: X', '',
      '### S2-1 · Ordinary story · [x]', '',
      '**Owner:** Cody · **Model:** `claude-sonnet-5` · **Size:** m · **Depends on:** S1-4', '',
      '**Scope:**',
      '- First bullet that runs on',
      '  and wraps to a second line',
      '- Second bullet', '',
      '**Acceptance criteria:**',
      '- [x] Something verified',
      '- [ ] Something not', '',
      '### S2-R · Retro · [ ]', '',
      '**Owner:** Nadia (runs it) and Lila (writes it) · **Size:** s', '',
      '### F2-1 · Fix story · [x]', '',
      '**Owner:** Quinn (QA — hired for this by Hannah)', ''
    ].join('\n');

    var stories = AMSSprints.parseStories(body);
    /* REGRESSION: story ids are not all S{n}-{m}; retros use -R and fix stories
       use an F prefix. A stricter regex silently dropped them from the board. */
    t.eq(stories.map(function (s) { return s.id; }), ['S2-1', 'S2-R', 'F2-1'],
      'S2-1, S2-R and F2-1 all parse');
    t.eq(stories.map(function (s) { return s.done; }), [true, false, true], 'checkbox states');

    t.eq(stories[0].owner, 'Cody', 'owner');
    t.eq(stories[0].model, 'claude-sonnet-5', 'model, backticks stripped');
    t.eq(stories[0].size, 'm', 'size');
    t.eq(stories[0].dependsOn, 'S1-4', 'depends on');

    /* REGRESSION: 8 of 66 real stories name two people. */
    t.eq(stories[1].owners, ['Nadia', 'Lila'], 'two owners split');
    t.eq(stories[2].owners, ['Quinn'], 'parenthetical commentary dropped');

    var scope = stories[0].sections.filter(function (s) { return s.label === 'Scope'; })[0];
    t.eq(scope.items.length, 2, 'scope bullets');
    t.ok(/runs on and wraps/.test(scope.items[0].text), 'wrapped continuation joined');
    var crit = stories[0].sections.filter(function (s) { return s.label === 'Acceptance criteria'; })[0];
    t.eq(crit.items.map(function (i) { return i.done; }), [true, false], 'criteria tick state');
    t.eq(scope.items[0].done, null, 'plain bullets have no tick state');
  });

  suite('sprints — owner values seen in real files', function (t) {
    [['Cody', ['Cody']],
     ['Sandy (Junior — Haiku 4.5)', ['Sandy']],
     ['Quinn (QA — Sonnet 5)', ['Quinn']],
     ['Luke (runs Muse) + Cody (Sonnet 5, analysis)', ['Luke', 'Cody']],
     ['Nadia (runs it) and Lila (writes it)', ['Nadia', 'Lila']],
     ['Sandy (Junior — Haiku 4.5) · *escalate to Cody on any generator gap*', ['Sandy']],
     ['Cody (Senior — Sonnet 5) — goroutine synchronization is a design question', ['Cody']]
    ].forEach(function (pair) {
      t.eq(AMSSprints.parseOwners(pair[0]), pair[1], 'owner: ' + pair[0].slice(0, 44));
    });
    t.eq(AMSSprints.parseOwners(''), [], 'empty owner');
    t.eq(AMSSprints.parseOwners(null), [], 'null owner');
  });

  suite('sprints — board model', function (t) {
    function sprint(id, status, boxes) {
      return AMSSprints.parseFile('sprint-' + id + '.md',
        '# Sprint ' + id + ': T\n\n' +
        boxes.map(function (b, i) { return '### S' + id + '-' + (i + 1) + ' · S · [' + b + ']\n'; }).join('\n') +
        '\n## Acceptance\n\n**Status:** ' + status + '\n');
    }

    /* REGRESSION: current sprint was "highest not accepted", which picks the
       furthest-planned sprint rather than the one being worked. */
    var m = AMSSprints.build([sprint(1, 'Accepted', ['x', 'x']),
                              sprint(2, 'Pending', ['x', ' ', ' ']),
                              sprint(3, 'Pending', [' ', ' '])]);
    t.eq(m.current.id, '2', 'current is the lowest not-accepted sprint');
    t.eq(m.inProgress.length, 1, 'exactly one story in progress');
    t.eq(m.inProgress[0].id, 'S2-2', 'in progress is the first open story of the current sprint');
    t.eq(m.sprints[2].stories.map(function (s) { return s.state; }), ['planned', 'planned'],
      'later sprints are planned, not in progress');

    /* An unchecked story inside an accepted sprint is dropped work, not
       upcoming work; spec §2.4 forbids it going forward but legacy files have
       it, and it must never be mistaken for planned. */
    var stale = AMSSprints.build([sprint(1, 'Accepted', ['x', ' ']), sprint(2, 'Pending', [' '])]);
    t.eq(stale.sprints[0].stories[1].state, 'stale', 'open story in an accepted sprint is stale');
    t.ok(stale.inProgress.length === 1 && stale.inProgress[0].id === 'S2-1',
      'a stale story does not become the in-progress one');

    /* muse-monitor: every sprint accepted. The board must not invent progress. */
    var done = AMSSprints.build([sprint(1, 'Accepted', ['x']), sprint(2, 'Accepted', ['x'])]);
    t.ok(done.allAccepted, 'allAccepted when nothing is pending');
    t.eq(done.current.id, '2', 'current falls to the last sprint');
    t.eq(done.inProgress.length, 0, 'no story is in progress when all are accepted');

    t.eq(AMSSprints.build([]).sprints.length, 0, 'empty board does not throw');
  });

  suite('sprints — file filter', function (t) {
    t.ok(AMSSprints.isSprintFile({ name: 'sprint-1.md' }), 'sprint-1.md');
    t.ok(AMSSprints.isSprintFile({ name: 'sprint-5a.md' }), 'sprint-5a.md');
    /* REGRESSION: PROTOCOL.md and roadmap.md live in the sprints directory and
       must not become rows. cellear/AMS has only PROTOCOL.md there. */
    t.ok(!AMSSprints.isSprintFile({ name: 'PROTOCOL.md' }), 'PROTOCOL.md excluded');
    t.ok(!AMSSprints.isSprintFile({ name: 'roadmap.md' }), 'roadmap.md excluded');
    t.ok(!AMSSprints.isSprintFile({ name: 'acceptance', type: 'dir' }), 'subdirectory excluded');
  });

  /* ------------------------------------------------------------------ *
   * Unit: CONFIG discovery                                              *
   * ------------------------------------------------------------------ */

  suite('ams — CONFIG parsing', function (t) {
    /* REGRESSION: the kit's CONFIG.md template ends with an "## Example: using
       existing folders" section holding a second table. Reading every table in
       the file resolved handoff_dir to `journal` and doc_dir to `docs` for
       every AMS project. */
    var cfg = AMSRepo.parseConfig([
      '# AMS Configuration', '',
      '## Components', '',
      '| Setting | Default | Your value |', '|---|---|---|',
      '| `components` | `HANDOFF` | `HANDOFF, SPRINTS` |', '',
      '## Directories', '',
      '| Setting | Default | Your value |', '|---|---|---|',
      '| `handoff_dir` | `HANDOFF` | |',
      '| `sprints_dir` | `SPRINTS` | |', '',
      '## Example: using existing folders', '',
      '| Setting | Default | Your value |', '|---|---|---|',
      '| `handoff_dir` | `HANDOFF` | `journal` |',
      '| `doc_dir` | `DOC` | `docs` |'
    ].join('\n'));
    t.eq(cfg.settings.handoff_dir, 'HANDOFF', 'the Example table does not win');
    t.eq(cfg.settings.doc_dir, undefined, 'the Example table contributes nothing');
    t.eq(AMSRepo.componentsList(cfg), ['HANDOFF', 'SPRINTS'], 'components list');

    /* muse-monitor's older CONFIG puts its live table in the preamble, under no
       heading at all — which is why sections are excluded by name rather than
       allowed by name. */
    var pre = AMSRepo.parseConfig([
      '# AMS Configuration', '',
      '| Setting | Default | Your value |', '|---|---|---|',
      '| `handoff_dir` | `HANDOFF` | |',
      '| `sprints_dir` | `SPRINTS` | `docs/sprints` |', '',
      '## Example: using existing folders', '',
      '| Setting | Default | Your value |', '|---|---|---|',
      '| `handoff_dir` | `HANDOFF` | `journal` |'
    ].join('\n'));
    t.eq(pre.settings.sprints_dir, 'docs/sprints', 'a "Your value" override wins');
    t.eq(pre.settings.handoff_dir, 'HANDOFF', 'preamble table read, Example still skipped');

    t.eq(AMSRepo.parseConfig('').settings, {}, 'empty config does not throw');
    t.eq(AMSRepo.componentsList({ components: null }), null, 'no components declared');
  });

  /* ------------------------------------------------------------------ *
   * Unit: handoffs                                                      *
   * ------------------------------------------------------------------ */

  suite('handoffs — filenames', function (t) {
    /* REGRESSION: splitting on hyphens broke the story id apart, so history
       read "s2 5 result page" instead of "S2-5 · result page · cody". */
    t.eq(AMSHandoffs.labelFromName('handoff-2026-08-30-s2-5-result-page-cody.md'),
      'S2-5 · result page · cody', 'story id rejoined');
    t.eq(AMSHandoffs.labelFromName('handoff-2026-08-30-sprint-2-planning-archie.md'),
      'sprint 2 planning · archie', 'no story id to rejoin');
    t.eq(AMSHandoffs.storyIdFromName('handoff-2026-08-29-s1-r-retro-nadia.md'), 'S1-R',
      'retro id');
    t.eq(AMSHandoffs.storyIdFromName('handoff-2026-08-29-f1-1-demo-runner-quinn.md'), 'F1-1',
      'fix-story id');
    t.eq(AMSHandoffs.storyIdFromName('handoff-2026-08-30-sprint-2-planning-archie.md'), null,
      'no id when the name does not carry one');
    t.eq(AMSHandoffs.agentFromName('handoff-2026-08-30-s2-5-result-page-cody.md'), 'cody',
      'agent from the filename');
    t.eq(AMSHandoffs.dateFromName('handoff-2026-08-30-x-y.md'), '2026-08-30', 'date');
    t.eq(AMSHandoffs.dateFromName('not-a-handoff.md'), null, 'non-handoff name');

    var sorted = AMSHandoffs.sortIndex([
      { name: 'handoff-2026-08-26-a-x.md' },
      { name: 'handoff-2026-08-30-b-y.md' },
      { name: 'handoff-2026-08-28-c-z.md' }
    ]).map(function (e) { return e.name.slice(8, 18); });
    t.eq(sorted, ['2026-08-30', '2026-08-28', '2026-08-26'], 'newest first');
  });

  suite('handoffs — heading mapping', function (t) {
    /* REGRESSION: exact-set matching is not viable. "Files created or modified"
       alone appears in four casings across the two reference projects, and
       there are 82 distinct headings in muse-monitor's 58 handoffs. */
    [['Summary', 'Context'], ['Current State', 'Context'], ['Current state / Blockers', 'Context'],
     ['What Was Done', "What's done"], ['What was attempted and the outcome', "What's done"],
     ['Outcome', "What's done"], ['What Worked / What Didn\'t', "What's done"],
     ['Next Steps', "What's next"], ['Recommendations made out of lane', "What's next"],
     ['Open Questions', 'Notes / blockers'], ['open questions', 'Notes / blockers'],
     ['Files Created/Modified', 'Files / references'],
     ['Files created or modified', 'Files / references'],
     ['files modified', 'Files / references']
    ].forEach(function (pair) {
      t.eq(AMSHandoffs.bucketFor(pair[0]), pair[1], '"' + pair[0] + '"');
    });
    t.eq(AMSHandoffs.bucketFor('Commit'), null, 'unrecognised heading maps to nothing');

    var parsed = AMSHandoffs.parse('handoff-2026-08-30-s2-1-x-cody.md', [
      '# Handoff', '', '## Summary', 'ctx body', '',
      '## What Was Done', 'done body', '',
      '## Commit', 'abc123', '',
      '## Prompt for Next Assistant', 'go do the thing'
    ].join('\n'));
    t.ok(parsed.mapped, 'at least one section mapped');
    t.eq(parsed.sections[0].parts.length, 1, 'Context filled from Summary');
    t.ok(!parsed.sections[0].parts[0].canonical, 'legacy heading marked non-canonical');
    t.eq(parsed.extras.map(function (e) { return e.heading; }), ['Commit'],
      'unmapped section preserved, not dropped');
    t.ok(parsed.prompt && /go do the thing/.test(parsed.prompt.body),
      'Prompt for Next Assistant extracted separately');
  });

  /* ------------------------------------------------------------------ *
   * Unit: repo input                                                    *
   * ------------------------------------------------------------------ */

  suite('config — repo input', function (t) {
    ['cellear/factcheck-site',
     'github.com/cellear/factcheck-site',
     'https://github.com/cellear/factcheck-site',
     'http://github.com/cellear/factcheck-site',
     'https://github.com/cellear/factcheck-site/',
     'https://github.com/cellear/factcheck-site/tree/main/AMS',
     'https://github.com/cellear/factcheck-site.git',
     'git@github.com:cellear/factcheck-site.git',
     '  cellear/factcheck-site  '
    ].forEach(function (input) {
      t.eq(AMSConfig.parseRepoInput(input).repo, 'cellear/factcheck-site',
        'accepts: ' + input.trim());
    });

    t.eq(AMSConfig.parseRepoInput('https://gitlab.com/a/b').reason, 'unsupported-host',
      'GitLab recognised, not merely rejected');
    t.eq(AMSConfig.parseRepoInput('https://gitlab.com/a/b').host, 'GitLab', 'named for the message');
    t.eq(AMSConfig.parseRepoInput('https://bitbucket.org/a/b').reason, 'unsupported-host',
      'Bitbucket recognised');
    t.eq(AMSConfig.parseRepoInput('https://example.com/a/b').reason, 'unknown-host', 'unknown host');
    t.eq(AMSConfig.parseRepoInput('justonething').reason, 'not-a-repo', 'single segment');
    t.eq(AMSConfig.parseRepoInput('').reason, 'empty', 'empty input');

    t.eq(AMSConfig.read('?fixtures=1').mode, 'fixtures', 'fixture mode');
    t.eq(AMSConfig.read('').reason, 'no-repo', 'no parameter');
    t.eq(AMSConfig.read('?repo=cellear/x').repo, 'cellear/x', 'repo parameter');
    t.eq(AMSConfig.read('?repo=https://github.com/cellear/x').repo, 'cellear/x',
      'a full URL in the parameter is normalised');
  });

  /* ------------------------------------------------------------------ *
   * Unit: agent colours                                                 *
   * ------------------------------------------------------------------ */

  suite('agents — colour assignment', function (t) {
    var roster = ['Sandy', 'Cody', 'Archie', 'Lila', 'Nadia', 'Quinn'];
    var a = AMSAgents.assign(roster);
    t.eq(a.Cody.name, 'blue', 'Cody is blue');
    t.eq(a.Sandy.name, 'orange', 'Sandy is orange');
    t.eq(a.Archie.name, 'brown', 'Archie is brown');
    t.eq(Object.keys(a).length, 6, 'every agent assigned');
    t.eq(new Set(Object.keys(a).map(function (k) { return a[k].name; })).size, 6,
      'no two agents on a board share a colour');

    /* Order must not matter: story order changes between polls, and a colour
       that shuffles is worse than no colour. */
    t.eq(JSON.stringify(AMSAgents.assign(['Zoe', 'Cody', 'Ada'])),
         JSON.stringify(AMSAgents.assign(['Ada', 'Cody', 'Zoe'])),
      'assignment is independent of input order');
    t.eq(AMSAgents.preferred('Fable').name, AMSAgents.preferred('Fable').name,
      'hashing is stable across calls');

    /* Named personas claim first, so an unfamiliar agent cannot displace Cody. */
    var crowded = AMSAgents.assign(['Zoe', 'Ada', 'Rex', 'Mo', 'Cody']);
    t.eq(crowded.Cody.name, 'blue', 'a named persona keeps its colour among strangers');

    var strangers = AMSAgents.assign(['Zoe', 'Ada', 'Rex', 'Mo']);
    t.eq(new Set(Object.keys(strangers).map(function (k) { return strangers[k].name; })).size, 4,
      'unknown agents still get distinct colours');

    /* Black body text has to stay legible on every fill: Luke's requirement. */
    function luminance(hex) {
      var c = parseInt(hex.slice(1), 16);
      var ch = [(c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255].map(function (v) {
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    AMSAgents.PALETTE.forEach(function (p) {
      var contrast = (luminance(p.fill) + 0.05) / 0.05;
      t.ok(contrast >= 4.5, 'black text legible on ' + p.name + ' (' + contrast.toFixed(1) + ':1)');
    });
    t.ok(!AMSAgents.preferred(''), 'no colour for an empty name');
  });

  return {
    suite: suite,
    suites: suites,
    Ctx: Ctx,
    run: function () {
      var results = [];
      suites.forEach(function (s) {
        try { s.fn(new Ctx(results, s.name)); }
        catch (e) {
          results.push({ suite: s.name, label: 'suite threw', pass: false, detail: e.message });
        }
      });
      return results;
    }
  };
})();
